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

const tag = (tag: string, value: string, props?: Attrs) => `<${tag}${props ? ` ${attrs(props)}` : ""}>${escape(value)}</${tag}>`;
export const th = (label: string, props?: Attrs) => tag("th", label, props) as Th;
export const td = (value: string, props?: Attrs) => tag("td", value, props) as Td;
export const table = <T extends string[][]>(rows: T) => `<table>\n${rows.map(cells => `  <tr>${cells.join("")}</tr>\n`).join("")}</table>`;
