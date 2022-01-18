import { keyMap } from '../jsutils/keyMap';
import type { Maybe } from '../jsutils/Maybe';

import type {
  DataTypeDefinitionNode,
  DirectiveDefinitionNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  ScalarTypeDefinitionNode,
  SchemaDefinitionNode,
  TypeDefinitionNode,
  TypeNode,
  ResolverTypeDefinitionNode,
  VariantDefinitionNode,
} from '../language/ast';
import { Kind } from '../language/kinds';
import { isTypeDefinitionNode } from '../language/predicates';

import type {
  GraphQLEnumValueConfigMap,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLNamedType,
  GraphQLType,
  IrisDataVariantFieldFields,
} from '../type/definition';
import {
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  IrisDataType,
  IrisResolverType,
} from '../type/definition';
import {
  GraphQLDeprecatedDirective,
  GraphQLDirective,
  GraphQLSpecifiedByDirective,
} from '../type/directives';
import { introspectionTypes } from '../type/introspection';
import { specifiedScalarTypes } from '../type/scalars';
import type {
  GraphQLSchemaNormalizedConfig,
  GraphQLSchemaValidationOptions,
} from '../type/schema';

import { getDirectiveValues } from '../execution/values';

import { valueFromAST } from './valueFromAST';

interface Options extends GraphQLSchemaValidationOptions {
  /**
   * Set to true to assume the SDL is valid.
   *
   * Default: false
   */
  assumeValidSDL?: boolean;
}

/**
 * Produces a new schema given an existing schema and a document which may
 * contain GraphQL type extensions and definitions. The original schema will
 * remain unaltered.
 *
 * Because a schema represents a graph of references, a schema cannot be
 * extended without effectively making an entire copy. We do not know until it's
 * too late if subgraphs remain unchanged.
 *
 * This algorithm copies the provided schema, applying extensions while
 * producing the copy. The original schema remains unaltered.
 */

/**
 * @internal
 */
export function extendSchemaImpl(
  schemaConfig: GraphQLSchemaNormalizedConfig,
  documentAST: DocumentNode,
  options?: Options,
): GraphQLSchemaNormalizedConfig {
  // Collect the type definitions and extensions found in the document.
  const typeDefs: Array<TypeDefinitionNode> = [];
  const typeExtensionsMap = Object.create(null);

  // New directives and types are separate because a directives and types can
  // have the same name. For example, a type named "skip".
  const directiveDefs: Array<DirectiveDefinitionNode> = [];

  let schemaDef: Maybe<SchemaDefinitionNode>;
  // Schema extensions are collected which may add additional operation types.

  for (const def of documentAST.definitions) {
    if (isTypeDefinitionNode(def)) {
      typeDefs.push(def);
    } else if (def.kind === Kind.DIRECTIVE_DEFINITION) {
      directiveDefs.push(def);
    }
  }

  // If this document contains no new types, extensions, or directives then
  // return the same unmodified GraphQLSchema instance.
  if (
    Object.keys(typeExtensionsMap).length === 0 &&
    typeDefs.length === 0 &&
    directiveDefs.length === 0 &&
    schemaDef == null
  ) {
    return schemaConfig;
  }

  const typeMap = Object.create(null);
  for (const existingType of schemaConfig.types) {
    typeMap[existingType.name] = existingType;
  }

  for (const typeNode of typeDefs) {
    const name = typeNode.name.value;
    typeMap[name] = stdTypeMap[name] ?? buildType(typeNode);
  }

  const operationTypes = {
    // Get the extended root operation types.
    query: schemaConfig.query && replaceNamedType(schemaConfig.query),
    mutation: schemaConfig.mutation && replaceNamedType(schemaConfig.mutation),
    subscription:
      schemaConfig.subscription && replaceNamedType(schemaConfig.subscription),
  };

  // Then produce and return a Schema config with these types.
  return {
    description: schemaDef?.description?.value,
    ...operationTypes,
    types: Object.values(typeMap),
    directives: [
      ...schemaConfig.directives,
      ...directiveDefs.map(buildDirective),
    ],
    extensions: Object.create(null),
    astNode: schemaDef ?? schemaConfig.astNode,
    assumeValid: options?.assumeValid ?? false,
  };

  function replaceNamedType<T extends GraphQLNamedType>(type: T): T {
    // Note: While this could make early assertions to get the correctly
    // typed values, that would throw immediately while type system
    // validation with validateSchema() will produce more actionable results.
    return typeMap[type.name];
  }

  function getNamedType(node: NamedTypeNode): GraphQLNamedType {
    const name = node.name.value;
    const type = stdTypeMap[name] ?? typeMap[name];

    if (type === undefined) {
      throw new Error(`Unknown type: "${name}".`);
    }
    return type;
  }

  function getWrappedType(node: TypeNode): GraphQLType {
    if (node.kind === Kind.LIST_TYPE) {
      return new GraphQLList(getWrappedType(node.type));
    }
    if (node.kind === Kind.NON_NULL_TYPE) {
      return new GraphQLNonNull(getWrappedType(node.type));
    }
    return getNamedType(node);
  }

  function buildDirective(node: DirectiveDefinitionNode): GraphQLDirective {
    return new GraphQLDirective({
      name: node.name.value,
      description: node.description?.value,
      // @ts-expect-error
      locations: node.locations.map(({ value }) => value),
      isRepeatable: node.repeatable,
      args: buildArgumentMap(node.arguments),
      astNode: node,
    });
  }

  function buildFieldMap(
    nodes: ReadonlyArray<ObjectTypeDefinitionNode>,
  ): GraphQLFieldConfigMap<unknown, unknown> {
    const fieldConfigMap = Object.create(null);
    for (const node of nodes) {
      // FIXME: https://github.com/graphql/graphql-js/issues/2203
      const nodeFields = /* c8 ignore next */ node.fields ?? [];

      for (const field of nodeFields) {
        fieldConfigMap[field.name.value] = {
          // Note: While this could make assertions to get the correctly typed
          // value, that would throw immediately while type system validation
          // with validateSchema() will produce more actionable results.
          type: getWrappedType(field.type),
          description: field.description?.value,
          args: buildArgumentMap(field.arguments),
          deprecationReason: getDeprecationReason(field),
          astNode: field,
        };
      }
    }
    return fieldConfigMap;
  }

  function buildArgumentMap(
    args: Maybe<ReadonlyArray<InputValueDefinitionNode>>,
  ): GraphQLFieldConfigArgumentMap {
    // FIXME: https://github.com/graphql/graphql-js/issues/2203
    const argsNodes = /* c8 ignore next */ args ?? [];

    const argConfigMap = Object.create(null);
    for (const arg of argsNodes) {
      // Note: While this could make assertions to get the correctly typed
      // value, that would throw immediately while type system validation
      // with validateSchema() will produce more actionable results.
      const type: any = getWrappedType(arg.type);

      argConfigMap[arg.name.value] = {
        type,
        description: arg.description?.value,
        defaultValue: valueFromAST(arg.defaultValue, type),
        deprecationReason: getDeprecationReason(arg),
        astNode: arg,
      };
    }
    return argConfigMap;
  }

  function buildInputFieldMap(
    nodes: ReadonlyArray<DataTypeDefinitionNode>,
  ): IrisDataVariantFieldFields {
    const inputFieldMap = Object.create(null);
    for (const node of nodes) {
      // FIXME: https://github.com/graphql/graphql-js/issues/2203
      const fieldsNodes = /* c8 ignore next */ node.variants[0].fields ?? [];

      for (const field of fieldsNodes) {
        // Note: While this could make assertions to get the correctly typed
        // value, that would throw immediately while type system validation
        // with validateSchema() will produce more actionable results.
        const type: any = getWrappedType(field.type);

        inputFieldMap[field.name.value] = {
          type,
          description: field.description?.value,
          defaultValue: valueFromAST(field.defaultValue, type),
          deprecationReason: getDeprecationReason(field),
          astNode: field,
        };
      }
    }
    return inputFieldMap;
  }

  function buildEnumValueMap(
    nodes: ReadonlyArray<DataTypeDefinitionNode>,
  ): GraphQLEnumValueConfigMap {
    const enumValueMap = Object.create(null);
    for (const node of nodes) {
      // FIXME: https://github.com/graphql/graphql-js/issues/2203
      const valuesNodes = /* c8 ignore next */ node.variants ?? [];

      for (const value of valuesNodes) {
        enumValueMap[value.name.value] = {
          description: value.description?.value,
          deprecationReason: getDeprecationReason(value),
          astNode: value,
        };
      }
    }
    return enumValueMap;
  }

  function buildUnionTypes(
    nodes: ReadonlyArray<ResolverTypeDefinitionNode>,
  ): Array<GraphQLObjectType> {
    // Note: While this could make assertions to get the correctly typed
    // values below, that would throw immediately while type system
    // validation with validateSchema() will produce more actionable results.
    // @ts-expect-error
    return nodes.flatMap(
      // FIXME: https://github.com/graphql/graphql-js/issues/2203
      (node) => /* c8 ignore next */ node.types?.map(getNamedType) ?? [],
    );
  }

  function buildType(astNode: TypeDefinitionNode): GraphQLNamedType {
    const name = astNode.name.value;
    const extensionASTNodes = typeExtensionsMap[name] ?? [];

    switch (astNode.kind) {
      case Kind.OBJECT_TYPE_DEFINITION: {
        const allNodes = [astNode, ...extensionASTNodes];

        return new GraphQLObjectType({
          name,
          description: astNode.description?.value,
          fields: () => buildFieldMap(allNodes),
          astNode,
        });
      }
      case Kind.RESOLVER_TYPE_DEFINITION: {
        const allNodes = [astNode, ...extensionASTNodes];

        return new IrisResolverType({
          name,
          description: astNode.description?.value,
          types: () => buildUnionTypes(allNodes),
          astNode,
        });
      }
      case Kind.SCALAR_TYPE_DEFINITION: {
        return new GraphQLScalarType({
          name,
          description: astNode.description?.value,
          specifiedByURL: getSpecifiedByURL(astNode),
          astNode,
        });
      }
      case Kind.DATA_TYPE_DEFINITION: {
        const [variant, ...ext] = astNode.variants;

        if (ext.length === 0 && variant.fields.length > 0) {
          return new IrisDataType({
            name,
            description: astNode.description?.value,
            fields: () => buildInputFieldMap([astNode]),
            astNode,
          });
        }

        return new IrisDataType({
          name,
          description: astNode.description?.value,
          values: buildEnumValueMap([astNode]),
          astNode,
        });
      }
    }
  }
}

const stdTypeMap = keyMap(
  [...specifiedScalarTypes, ...introspectionTypes],
  (type) => type.name,
);

/**
 * Given a field or enum value node, returns the string value for the
 * deprecation reason.
 */
function getDeprecationReason(
  node:
    | EnumValueDefinitionNode
    | FieldDefinitionNode
    | InputValueDefinitionNode
    | VariantDefinitionNode,
): Maybe<string> {
  const deprecated = getDirectiveValues(GraphQLDeprecatedDirective, node);
  // @ts-expect-error validated by `getDirectiveValues`
  return deprecated?.reason;
}

/**
 * Given a scalar node, returns the string value for the specifiedByURL.
 */
function getSpecifiedByURL(node: ScalarTypeDefinitionNode): Maybe<string> {
  const specifiedBy = getDirectiveValues(GraphQLSpecifiedByDirective, node);
  // @ts-expect-error validated by `getDirectiveValues`
  return specifiedBy?.url;
}
