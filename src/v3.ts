import propertyMapper from "./property-mapper";
import { OpenAPI3, OpenAPI3SchemaObject, SwaggerToTSOptions } from "./types";
import {
  comment,
  nodeType,
  transformRef,
  tsArrayOf,
  tsIntersectionOf,
  tsPartial,
  tsUnionOf,
  tsTupleOf,
} from "./utils";

export const PRIMITIVES: { [key: string]: "boolean" | "string" | "number" } = {
  // boolean types
  boolean: "boolean",

  // string types
  string: "string",

  // number types
  integer: "number",
  number: "number",
};

const ALIASES: { [key: string]: "string" } = {
  UTCDateTime: "string",
  UTCDate: "string",
};

export default function generateTypesV3(
  schema: OpenAPI3,
  options?: SwaggerToTSOptions
): string {
  if (!schema.components || !schema.components.schemas) {
    throw new Error(
      `⛔️ 'components' missing from schema https://swagger.io/specification`
    );
  }

  // propertyMapper
  const propertyMapped = options
    ? propertyMapper(schema.components.schemas, options.propertyMapper)
    : schema.components.schemas;

  // type converter
  function transform(node: OpenAPI3SchemaObject): string {
    switch (nodeType(node)) {
      case "ref": {
        return transformRef(node.$ref);
      }
      case "string":
      case "number":
      case "UTCDateTime":
      case "UTCDate":
      case "boolean": {
        return nodeType(node) || "any";
      }
      case "enum": {
        return tsUnionOf(
          (node.enum as string[]).map((item) =>
            typeof item === "number" || typeof item === "boolean"
              ? item
              : `'${item}'`
          )
        );
      }
      case "oneOf": {
        return tsUnionOf((node.oneOf as any[]).map(transform));
      }
      case "anyOf": {
        return tsIntersectionOf(
          (node.anyOf as any[]).map((anyOf) => tsPartial(transform(anyOf)))
        );
      }
      case "object": {
        // if empty object, then return generic map type
        if (
          (!node.properties || !Object.keys(node.properties).length) &&
          !node.allOf &&
          !node.additionalProperties
        ) {
          return `{ [key: string]: any }`;
        }

        let properties = createKeys(node.properties || {}, node.required);

        // if additional properties, add to end of properties
        if (node.additionalProperties) {
          properties += `[key: string]: ${
            node.additionalProperties === true
              ? "any"
              : transform(node.additionalProperties) || "any"
          };\n`;
        }

        return tsIntersectionOf([
          ...(node.allOf ? (node.allOf as any[]).map(transform) : []), // append allOf first
          ...(properties ? [`{ ${properties} }`] : []), // then properties + additionalProperties
        ]);
      }
      case "array": {
        if (Array.isArray(node.items)) {
          return tsTupleOf(node.items.map(transform));
        } else {
          return tsArrayOf(transform(node.items as any));
        }
      }
    }

    return "";
  }

  function createKeys(
    obj: { [key: string]: any },
    required?: string[],
    isInterface?: boolean
  ): string {
    let output = "";
    const sortedEntries = Object.entries(obj).sort((a, b) => a[0] < b[0] ? -1 : 1)
    sortedEntries.forEach(([key, value]) => {
      // 1. JSDoc comment (goes above property)
      if (value.description) {
        output += comment(value.description);
      }

      // 2. name (with “?” if optional property)
      output += `${isInterface ? "export interface " : "\""}${key}${isInterface ? "" : "\""}${!required || !required.includes(key) ? "?" : ""}${isInterface ? "" : ":"} `;

      // 3. open nullable
      if (value.nullable) {
        output += "(";
      }

      // 4. transform
      output += transform(value);

      // 5. close nullable
      if (value.nullable) {
        output += ") | null";
      }

      // 6. close type
      output += ";\n";
    });

    return output;
  }

  const schemas = `
    ${createKeys(propertyMapped, Object.keys(propertyMapped), true)}
  `;

  // const responses = !schema.components.responses
  //   ? ``
  //   : `responses: {
  //   ${createKeys(
  //     schema.components.responses,
  //     Object.keys(schema.components.responses)
  //   )}
  // }`;

  const aliases = Object.entries(ALIASES).map(([key, value]) => {
    return `export type ${key} = ${value};`;
  }).join('\n');

  // note: make sure that base-level schemas are required
  return `
    ${aliases}
    ${schemas}
  `;
}
