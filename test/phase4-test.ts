/**
 * Phase 4 Test: DataFrame Operations
 * - filter, map, sort
 * - groupBy with aggregates
 * - join operations
 */

import { CSVParser } from "../src/ts/parser";
import { DataFrame, GroupedDataFrame } from "../src/ts/dataframe";

console.log("=== Phase 4: DataFrame Operations Test ===\n");

// 1. Basic DataFrame from Parser
console.log("1. Loading CSV into DataFrame:");
const parser = new CSVParser("samples/customers-100.csv");
const df = parser.toDataFrame();

console.log(`   Rows: ${df.length}`);
console.log(`   Columns: ${df.getColumns().join(", ")}`);

// 2. Select columns
console.log("\n2. Select Columns:");
const selected = df.select("First Name", "Last Name", "Country");
console.log(`   Selected columns: ${selected.getColumns().join(", ")}`);
console.log(`   First row:`, selected.first(1)[0]);

// 3. Filter rows
console.log("\n3. Filter Rows:");
const usCustomers = df.filter((row: any) => row["Country"] === "United States");
console.log(`   US customers: ${usCustomers.length}`);

const ukCustomers = df.filter((row: any) => row["Country"] === "United Kingdom");
console.log(`   UK customers: ${ukCustomers.length}`);

// 4. Sort
console.log("\n4. Sort Operations:");
const sortedByName = df.sorted("First Name", "asc");
console.log(`   First 3 names (sorted):`,
  sortedByName.first(3).map((r: any) => r["First Name"]));

const sortedByNameDesc = df.sorted("First Name", "desc");
console.log(`   First 3 names (desc):`,
  sortedByNameDesc.first(3).map((r: any) => r["First Name"]));

// 5. Map transformation
console.log("\n5. Map Transformation:");
const fullNames = df.map((row: any) => ({
  fullName: `${row["First Name"]} ${row["Last Name"]}`,
  country: row["Country"],
}));
console.log(`   Sample full names:`, fullNames.first(3).map((r: any) => r.fullName));

// 6. GroupBy and Aggregate
console.log("\n6. GroupBy and Aggregation:");
const byCountry = df.groupBy("Country");
const countryCounts = byCountry.aggregate({
  customerCount: { col: "Index", fn: "count" },
});

console.log(`   Customers by country:`);
for (const row of countryCounts.first(10)) {
  console.log(`   - ${(row as any)["Country"]}: ${(row as any)["customerCount"]}`);
}

// 7. Join operations
console.log("\n7. Join Operations:");

// Create two small DataFrames to test joins
const orders = new DataFrame([
  { orderId: 1, customerId: "DD37Cf93aecA6Dc", amount: 100 },
  { orderId: 2, customerId: "1Ef7b82A4CAAD10", amount: 250 },
  { orderId: 3, customerId: "UNKNOWN", amount: 50 },
]);

const customers = new DataFrame([
  { customerId: "DD37Cf93aecA6Dc", name: "Sheryl Baxter" },
  { customerId: "1Ef7b82A4CAAD10", name: "Preston Lozano" },
  { customerId: "OTHER", name: "Unknown Customer" },
]);

// Inner join
const innerJoined = orders.join(customers, {
  on: "customerId",
  type: "inner",
});
console.log(`   Inner join results: ${innerJoined.length} rows`);
for (const row of innerJoined) {
  console.log(`   - Order ${(row as any).orderId}: ${(row as any).name} - $${(row as any).amount}`);
}

// Left join
const leftJoined = orders.join(customers, {
  on: "customerId",
  type: "left",
});
console.log(`\n   Left join results: ${leftJoined.length} rows`);
for (const row of leftJoined) {
  console.log(`   - Order ${(row as any).orderId}: ${(row as any).name || "(no customer)"} - $${(row as any).amount}`);
}

// 8. Chained operations
console.log("\n8. Chained Operations:");
const result = df
  .filter((row: any) => row["Country"] === "United States")
  .sorted("First Name", "asc")
  .select("First Name", "Last Name", "City");

console.log(`   US customers sorted by name:`);
for (const row of result.first(5)) {
  console.log(`   - ${(row as any)["First Name"]} ${(row as any)["Last Name"]} (${(row as any)["City"]})`);
}

// 9. Multiple aggregations
console.log("\n9. Multiple Aggregations:");
// Create DataFrame with numeric data
const salesData = new DataFrame([
  { region: "North", sales: 100, units: 10 },
  { region: "North", sales: 150, units: 15 },
  { region: "South", sales: 200, units: 20 },
  { region: "South", sales: 180, units: 18 },
  { region: "East", sales: 120, units: 12 },
]);

const regionStats = salesData.groupBy("region").aggregate({
  totalSales: { col: "sales", fn: "sum" },
  avgSales: { col: "sales", fn: "mean" },
  maxUnits: { col: "units", fn: "max" },
  count: { col: "region", fn: "count" },
});

console.log("   Region statistics:");
for (const row of regionStats) {
  console.log(`   - ${(row as any)["region"]}: Total=$${(row as any).totalSales}, Avg=$${(row as any).avgSales.toFixed(2)}, MaxUnits=${(row as any).maxUnits}, Count=${(row as any).count}`);
}

// 10. Custom aggregate function
console.log("\n10. Custom Aggregate Function:");
const customAgg = salesData.groupBy("region").aggregate({
  salesRange: {
    col: "sales",
    fn: (values: number[]) => {
      const nums = values.filter(v => typeof v === "number") as number[];
      return Math.max(...nums) - Math.min(...nums);
    },
  },
});

console.log("   Sales range by region:");
for (const row of customAgg) {
  console.log(`   - ${(row as any)["region"]}: Range=${(row as any).salesRange}`);
}

parser.close();

console.log("\n=== Phase 4 Tests Complete ===");
