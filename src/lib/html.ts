const replacements = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
};
const pattern = new RegExp(`[${Object.keys(replacements).join("")}]`, "g");
const escape = (s: string) => s.replace(pattern, c => replacements[c as keyof typeof replacements]);

type Attrs = Record<string, string | number>;
export function attrs(props: Attrs): string {
  return Object.entries(props).map(([k, v]) => `${escape(k)}="${escape(String(v))}"`).join(" ");
}

type Tuple<T, N extends number, Acc extends T[] = []> = Acc["length"] extends N ? Acc : Tuple<T, N, [...Acc, T]>;
type Th = string & {__brand: "th"};
type Td = string & {__brand: "td"};
export type Row<ThCount extends number, TdCount extends number> = [...Tuple<Th, ThCount>, ...Tuple<Td, TdCount>];

const tag = (tag: string, value?: string | null, props?: Attrs) => {
  const open = `<${tag}${props ? ` ${attrs(props)}` : ""} ${value == null ? `/` : ""}>`;
  const inner = value == null ? "" : escape(value);
  const close = value == null ? "" : `</${tag}>`;
  return open + inner + close;
}

type TdAttrs = {align: "left" | "center" | "right", title: string};
type ThAttrs = TdAttrs & {scope: "row" | "col"};
export const th = (label: string, attrs?: Partial<ThAttrs>) => tag("th", label, attrs) as Th;
export const td = (value: string, attrs?: Partial<TdAttrs>) => tag("td", value, attrs) as Td;
export const table = <T extends string[][]>(rows: T) =>
  `<table>\n${
    rows.map(cells => `  <tr>${cells.map(d => `\n    ${d}`).join("")}\n  </tr>\n`).join("")
  }</table>`;
