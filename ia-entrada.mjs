// Entrada para armar vendor/anthropic-sdk.js (npm run vendor): el SDK oficial de
// Anthropic empaquetado para el navegador, sin build en la app.
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
export { Anthropic, betaJSONSchemaOutputFormat };
