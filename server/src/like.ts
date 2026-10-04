/** An `ilike` pattern for text containing `query` as typed: `%`, `_` and `\` are not wildcards here. */
export const containing = (query: string) => `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
