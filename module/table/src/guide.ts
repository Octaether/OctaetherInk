// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const tableGuide = String.raw`Rows of data, as CSV on the lines below: the column names first, then one row per line (a cell with a comma goes in "quotes"; dates as 2026-11-02). For data, prefer a Table over a Markdown table: it sorts, sums, and feeds plots. Title names the table, and is how a Plot or a Calendar finds it (Data: the title). Other settings: Column: {Name: {Type, Unit, Decimal, Summary, Formula}} with Type one of Text, Number, Date, DateTime, Checkbox, Tag, Link (guessed when not given; a Tag cell holds one or more tags separated by commas, "Ada Lovelace, Lab", and Tag: [To do, Done] gives the tags in order), Summary one of Count, Sum, Average, Median, Min, Max, Range, and Formula an expression over the other columns (Calorie - Burned; a name with a space is written with _); Sort: {Date: Down}; Group: Name; Show: Table, Board, Gallery, or List. "Table: Expense.csv" shows a .csv or .xlsx file of the vault instead of rows.

<example>
Table {Title: Gym log, Column: {Calorie: {Unit: kcal, Summary: Average}, Weight: {Unit: kg}}, Sort: {Date: Down}}:
	Date,Workout,Calorie,Weight
	2026-11-02,Legs,520,72.4
	2026-11-04,Push,410,72.1
</example>`;
