/**
 * Snippet templating: `{{name}}` placeholders that are filled in at paste time.
 *
 * A placeholder is `{{name}}` or `{{name=default}}`. The name must start with a
 * letter, which keeps Go/Docker format strings (`{{.Names}}`, `{{range .Mounts}}`)
 * out of the way — those are common enough in a terminal that silently treating
 * them as variables would be worse than not having the feature. Bare Go keywords
 * such as `{{end}}` do look like a valid name, so they are excluded explicitly.
 * Anything the heuristics still get wrong can be escaped as `\{{`.
 */

export interface SnippetVariable {
  name: string;
  defaultValue: string;
}

/** Go template keywords that would otherwise parse as a variable name. */
const RESERVED_NAMES = new Set([
  'end',
  'else',
  'range',
  'if',
  'with',
  'template',
  'define',
  'block',
  'break',
  'continue',
  'nil',
  'true',
  'false',
]);

/** Matches an escaped opener (`\{{`) or a `{{name}}` / `{{name=default}}` placeholder. */
const TOKEN_PATTERN = /\\\{\{|\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?:=([^{}]*))?\}\}/g;

function isVariableToken(name: string | undefined): name is string {
  return name !== undefined && !RESERVED_NAMES.has(name.toLowerCase());
}

/**
 * Collects the variables a snippet asks for, in the order they first appear.
 * Repeating the same name reuses one answer, so `pm2 restart {{id}} && pm2 logs {{id}}`
 * only prompts once.
 */
export function parseSnippetVariables(template: string): SnippetVariable[] {
  const found = new Map<string, SnippetVariable>();

  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const [, name, defaultValue] = match;
    if (!isVariableToken(name)) continue;

    const existing = found.get(name);
    if (!existing) {
      found.set(name, { name, defaultValue: defaultValue ?? '' });
    } else if (!existing.defaultValue && defaultValue) {
      existing.defaultValue = defaultValue;
    }
  }

  return [...found.values()];
}

export function hasSnippetVariables(template: string): boolean {
  return parseSnippetVariables(template).length > 0;
}

/**
 * Substitutes the collected answers back into the template. Unanswered variables
 * fall back to their default, then to an empty string, so a half-filled form can
 * still produce a previewable command.
 */
export function applySnippetVariables(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(TOKEN_PATTERN, (token, name?: string, defaultValue?: string) => {
    if (!isVariableToken(name)) {
      return token === '\\{{' ? '{{' : token;
    }
    return values[name] ?? defaultValue ?? '';
  });
}
