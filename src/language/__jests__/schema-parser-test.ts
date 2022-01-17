import { dedent } from '../../__testUtils__/dedent';
import {
  expectJSON,
  expectToThrowJSON,
  toJSONDeep,
} from '../../__testUtils__/expectJSON';

import { parse } from '../parser';

function expectSyntaxError(text: string) {
  return expectToThrowJSON(() => parse(text));
}

function typeNode(name: unknown, loc: unknown) {
  return {
    kind: 'NamedType',
    name: nameNode(name, loc),
    loc,
  };
}

function nameNode(name: unknown, loc: unknown) {
  return {
    kind: 'Name',
    value: name,
    loc,
  };
}

function fieldNode(name: unknown, type: unknown, loc: unknown) {
  return fieldNodeWithArgs(name, type, [], loc);
}

function fieldNodeWithArgs(
  name: unknown,
  type: unknown,
  args: unknown,
  loc: unknown,
) {
  return {
    kind: 'FieldDefinition',
    description: undefined,
    name,
    arguments: args,
    type,
    directives: [],
    loc,
  };
}

function enumValueNode(name: unknown, loc: unknown) {
  return {
    description: undefined,
    kind: 'VariantDefinition',
    name: nameNode(name, loc),
    directives: [],
    loc,
    fields: [],
  };
}

function inputValueNode(
  name: unknown,
  type: unknown,
  defaultValue: unknown,
  loc: unknown,
) {
  return {
    kind: 'InputValueDefinition',
    name,
    description: undefined,
    type,
    defaultValue,
    directives: [],
    loc,
  };
}

describe('Schema Parser', () => {
  it('Simple type', () => {
    const doc = parse(dedent`
      resolver Hello {
        world: String
      }
    `);
    expect(toJSONDeep(doc)).toMatchSnapshot();
  });

  it('parses type with description string', () => {
    const doc = parse(dedent`
      "Description"
      type Hello {
        world: String
      }
    `);
    expect(toJSONDeep(doc).definitions[0].description).toMatchSnapshot();


  });

  it('parses type with description multi-line string', () => {
    const doc = parse(dedent`
      """
      Description
      """
      # Even with comments between them
      type Hello {
        world: String
      }
    `);

    expectJSON(doc).toDeepNestedProperty('definitions[0].description', {
      kind: 'StringValue',
      value: 'Description',
      block: true,
      loc: { start: 0, end: 19 },
    });
  });

  it('Description followed by something other than type system definition throws', () => {
    expectSyntaxError('"Description" 1').to.deep.equal({
      locations: [{ column: 15, line: 1 }],
      message: 'Syntax Error: Unexpected Int "1".',
    });
  });

  it('Simple non-null type', () => {
    const doc = parse(dedent`
      type Hello {
        world: String!
      }
    `);

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ObjectTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          fields: [
            fieldNode(
              nameNode('world', { start: 15, end: 20 }),
              {
                kind: 'NonNullType',
                type: typeNode('String', { start: 22, end: 28 }),
                loc: { start: 22, end: 29 },
              },
              { start: 15, end: 29 },
            ),
          ],
          loc: { start: 0, end: 31 },
        },
      ],
      loc: { start: 0, end: 31 },
    });
  });

  it('Single value Enum', () => {
    const doc = parse('data Hello = WORLD');

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'DataTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          variants: [enumValueNode('WORLD', { start: 13, end: 18 })],
          loc: { start: 0, end: 18 },
        },
      ],
      loc: { start: 0, end: 18 },
    });
  });

  it('Double value Enum', () => {
    const doc = parse('data Hello = WO | RLD');

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'DataTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          variants: [
            enumValueNode('WO', { start: 13, end: 15 }),
            enumValueNode('RLD', { start: 18, end: 21 }),
          ],
          loc: { start: 0, end: 21 },
        },
      ],
      loc: { start: 0, end: 21 },
    });
  });

  it('Simple field with arg', () => {
    const doc = parse(dedent`
      type Hello {
        world(flag: Boolean): String
      }
    `);

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ObjectTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          fields: [
            fieldNodeWithArgs(
              nameNode('world', { start: 15, end: 20 }),
              typeNode('String', { start: 37, end: 43 }),
              [
                inputValueNode(
                  nameNode('flag', { start: 21, end: 25 }),
                  typeNode('Boolean', { start: 27, end: 34 }),
                  undefined,
                  { start: 21, end: 34 },
                ),
              ],
              { start: 15, end: 43 },
            ),
          ],
          loc: { start: 0, end: 45 },
        },
      ],
      loc: { start: 0, end: 45 },
    });
  });

  it('Simple field with arg with default value', () => {
    const doc = parse(dedent`
      type Hello {
        world(flag: Boolean = true): String
      }
    `);

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ObjectTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          fields: [
            fieldNodeWithArgs(
              nameNode('world', { start: 15, end: 20 }),
              typeNode('String', { start: 44, end: 50 }),
              [
                inputValueNode(
                  nameNode('flag', { start: 21, end: 25 }),
                  typeNode('Boolean', { start: 27, end: 34 }),
                  {
                    kind: 'BooleanValue',
                    value: true,
                    loc: { start: 37, end: 41 },
                  },
                  { start: 21, end: 41 },
                ),
              ],
              { start: 15, end: 50 },
            ),
          ],
          loc: { start: 0, end: 52 },
        },
      ],
      loc: { start: 0, end: 52 },
    });
  });

  it('Simple field with list arg', () => {
    const doc = parse(dedent`
      type Hello {
        world(things: [String]): String
      }
    `);

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ObjectTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          fields: [
            fieldNodeWithArgs(
              nameNode('world', { start: 15, end: 20 }),
              typeNode('String', { start: 40, end: 46 }),
              [
                inputValueNode(
                  nameNode('things', { start: 21, end: 27 }),
                  {
                    kind: 'ListType',
                    type: typeNode('String', { start: 30, end: 36 }),
                    loc: { start: 29, end: 37 },
                  },
                  undefined,
                  { start: 21, end: 37 },
                ),
              ],
              { start: 15, end: 46 },
            ),
          ],
          loc: { start: 0, end: 48 },
        },
      ],
      loc: { start: 0, end: 48 },
    });
  });

  it('Simple field with two args', () => {
    const doc = parse(dedent`
      type Hello {
        world(argOne: Boolean, argTwo: Int): String
      }
    `);

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ObjectTypeDefinition',
          name: nameNode('Hello', { start: 5, end: 10 }),
          description: undefined,
          directives: [],
          fields: [
            fieldNodeWithArgs(
              nameNode('world', { start: 15, end: 20 }),
              typeNode('String', { start: 52, end: 58 }),
              [
                inputValueNode(
                  nameNode('argOne', { start: 21, end: 27 }),
                  typeNode('Boolean', { start: 29, end: 36 }),
                  undefined,
                  { start: 21, end: 36 },
                ),
                inputValueNode(
                  nameNode('argTwo', { start: 38, end: 44 }),
                  typeNode('Int', { start: 46, end: 49 }),
                  undefined,
                  { start: 38, end: 49 },
                ),
              ],
              { start: 15, end: 58 },
            ),
          ],
          loc: { start: 0, end: 60 },
        },
      ],
      loc: { start: 0, end: 60 },
    });
  });

  it('Simple resolver', () => {
    const doc = parse('resolver Hello = World');

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ResolverTypeDefinition',
          name: nameNode('Hello', { start: 9, end: 14 }),
          description: undefined,
          directives: [],
          variants: [],
          types: [typeNode('World', { start: 17, end: 22 })],
          loc: { start: 0, end: 22 },
        },
      ],
      loc: { start: 0, end: 22 },
    });
  });

  it('Union with two types', () => {
    const doc = parse('resolver Hello = Wo | Rld');

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ResolverTypeDefinition',
          name: nameNode('Hello', { start: 9, end: 14 }),
          description: undefined,
          directives: [],
          variants: [],
          types: [
            typeNode('Wo', { start: 17, end: 19 }),
            typeNode('Rld', { start: 22, end: 25 }),
          ],
          loc: { start: 0, end: 25 },
        },
      ],
      loc: { start: 0, end: 25 },
    });
  });

  it('Union with two types and leading pipe', () => {
    const doc = parse('resolver Hello = | Wo | Rld');

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ResolverTypeDefinition',
          name: nameNode('Hello', { start: 9, end: 14 }),
          description: undefined,
          directives: [],
          variants: [],
          types: [
            typeNode('Wo', { start: 19, end: 21 }),
            typeNode('Rld', { start: 24, end: 27 }),
          ],
          loc: { start: 0, end: 27 },
        },
      ],
      loc: { start: 0, end: 27 },
    });
  });

  it('Union fails with no types', () => {
    expectSyntaxError('resolver Hello = |').to.deep.equal({
      message: 'Syntax Error: Expected Name, found <EOF>.',
      locations: [{ line: 1, column: 19 }],
    });
  });

  it('Union fails with leading double pipe', () => {
    expectSyntaxError('resolver Hello = || Wo | Rld').to.deep.equal({
      message: 'Syntax Error: Expected Name, found "|".',
      locations: [{ line: 1, column: 19 }],
    });
  });

  it('Union fails with double pipe', () => {
    expectSyntaxError('resolver Hello = Wo || Rld').to.deep.equal({
      message: 'Syntax Error: Expected Name, found "|".',
      locations: [{ line: 1, column: 22 }],
    });
  });

  it('Union fails with trailing pipe', () => {
    expectSyntaxError('resolver Hello = | Wo | Rld |').to.deep.equal({
      message: 'Syntax Error: Expected Name, found <EOF>.',
      locations: [{ line: 1, column: 30 }],
    });
  });

  it('Scalar', () => {
    const doc = parse('scalar Hello');

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'ScalarTypeDefinition',
          name: nameNode('Hello', { start: 7, end: 12 }),
          description: undefined,
          directives: [],
          loc: { start: 0, end: 12 },
        },
      ],
      loc: { start: 0, end: 12 },
    });
  });

  it('Simple data object', () => {
    const doc = parse(`
    data Hello {
      world: String
    }`);

    const name = nameNode('Hello', { start: 10, end: 15 });

    expectJSON(doc).toDeepEqual({
      kind: 'Document',
      definitions: [
        {
          kind: 'DataTypeDefinition',
          name,
          description: undefined,
          directives: [],
          variants: [
            {
              description: undefined,
              kind: 'VariantDefinition',
              loc: {
                end: 43,
                start: 16,
              },
              name,
              directives: [],
              fields: [
                inputValueNode(
                  nameNode('world', { start: 24, end: 29 }),
                  typeNode('String', { start: 31, end: 37 }),
                  undefined,
                  { start: 24, end: 37 },
                ),
              ],
            },
          ],
          loc: { start: 5, end: 43 },
        },
      ],
      loc: { start: 0, end: 43 },
    });
  });

  it('Simple data object with args should fail', () => {
    expectSyntaxError(`
      data  Hello {
        world(foo: Int): String
      }
    `).to.deep.equal({
      message: 'Syntax Error: Expected ":", found "(".',
      locations: [{ line: 3, column: 14 }],
    });
  });
});
