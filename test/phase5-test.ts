/**
 * Phase 5 Test: Write Support
 * - CSVWriter with buffered output
 * - Copy-on-write modifications (setCell, deleteRow, insertRow, save)
 */

import { CSVParser } from "../src/ts/parser";
import { CSVWriter, ModificationLog } from "../src/ts/writer";
import { existsSync, unlinkSync, readFileSync } from "fs";

console.log("=== Phase 5: Write Support Test ===\n");

// Helper to clean up test files
function cleanup(...paths: string[]) {
  for (const path of paths) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

// 1. Basic CSVWriter
console.log("1. Basic CSVWriter:");
const outputPath1 = "/tmp/phase5-test-basic.csv";
cleanup(outputPath1);

const writer1 = new CSVWriter(outputPath1);
writer1.writeHeader(["name", "age", "city"]);
writer1.writeRow(["Alice", 30, "New York"]);
writer1.writeRow(["Bob", 25, "Los Angeles"]);
writer1.writeRow(["Charlie", 35, "Chicago"]);
writer1.close();

const content1 = readFileSync(outputPath1, "utf-8");
console.log(`   Written to: ${outputPath1}`);
console.log(`   Row count: ${writer1.getRowCount()}`);
console.log(`   Content:\n${content1.split("\n").map(l => "   " + l).join("\n")}`);

// 2. Writer with auto-flush
console.log("\n2. Writer with Auto-flush:");
const outputPath2 = "/tmp/phase5-test-flush.csv";
cleanup(outputPath2);

const writer2 = new CSVWriter(outputPath2, { flushEvery: 2 });
writer2.writeHeader(["id", "value"]);
for (let i = 1; i <= 5; i++) {
  writer2.writeRow([i, `value-${i}`]);
  console.log(`   After row ${i}: written=${writer2.getRowCount()}`);
}
writer2.close();

// 3. Writer with quoting
console.log("\n3. Writer with Quoting:");
const outputPath3 = "/tmp/phase5-test-quotes.csv";
cleanup(outputPath3);

const writer3 = new CSVWriter(outputPath3);
writer3.writeRow(["hello, world", "normal", "with \"quotes\""]);
writer3.writeRow(["line1\nline2", "tab\there", "plain"]);
writer3.close();

const content3 = readFileSync(outputPath3, "utf-8");
console.log(`   Content with special characters:\n${content3.split("\n").map(l => "   " + l).join("\n")}`);

// 4. ModificationLog standalone test
console.log("\n4. ModificationLog:");
const log = new ModificationLog();

log.setCell(0, 1, "modified-value");
log.setCell(2, "name", "New Name");
log.deleteRow(5);
log.insertRow(0, ["inserted", "row", "here"]);

console.log(`   Cell edits: ${log.getCellEdit(0, 1)}`);
console.log(`   Is row 5 deleted: ${log.isDeleted(5)}`);
console.log(`   Is row 0 deleted: ${log.isDeleted(0)}`);
console.log(`   Modification count: ${log.modificationCount}`);
console.log(`   Has modifications: ${log.hasModifications}`);

log.clear();
console.log(`   After clear - has modifications: ${log.hasModifications}`);

// 5. Copy-on-write: setCell
console.log("\n5. Copy-on-Write - setCell:");

// First create a test CSV file
const testDataPath = "/tmp/phase5-test-data.csv";
cleanup(testDataPath);
const setupWriter = new CSVWriter(testDataPath);
setupWriter.writeHeader(["name", "age", "city"]);
setupWriter.writeRow(["Alice", "30", "New York"]);
setupWriter.writeRow(["Bob", "25", "Los Angeles"]);
setupWriter.writeRow(["Charlie", "35", "Chicago"]);
setupWriter.close();

// Now test copy-on-write modifications
const parser1 = new CSVParser(testDataPath, { writable: true });
console.log(`   Original file created with ${3} data rows`);
console.log(`   Parser is writable: ${parser1.writable}`);
console.log(`   Initial modification count: ${parser1.modificationCount}`);

parser1.setCell(0, "age", "31");  // Alice age 30 -> 31
parser1.setCell(1, 0, "Robert"); // Bob -> Robert

console.log(`   After 2 setCell calls: ${parser1.modificationCount} modifications`);
console.log(`   Modified age for Alice: ${parser1.getCell(0, "age")}`);
console.log(`   Modified name for Bob: ${parser1.getCell(1, "name")}`);

// 6. Copy-on-write: deleteRow
console.log("\n6. Copy-on-Write - deleteRow:");
parser1.deleteRow(2);  // Delete Charlie
console.log(`   Deleted row 2 (Charlie)`);
console.log(`   Modification count: ${parser1.modificationCount}`);
console.log(`   Charlie's name (should be null): ${parser1.getCell(2, "name")}`);

// 7. Copy-on-write: insertRow
console.log("\n7. Copy-on-Write - insertRow:");
parser1.insertRow(0, ["Diana", "28", "Seattle"]);
console.log(`   Inserted new row at position 0`);
console.log(`   Modification count: ${parser1.modificationCount}`);

// 8. Copy-on-write: save
console.log("\n8. Copy-on-Write - save:");
const modifiedPath = "/tmp/phase5-test-modified.csv";
cleanup(modifiedPath);

parser1.save(modifiedPath);
console.log(`   Saved modifications to: ${modifiedPath}`);

const modifiedContent = readFileSync(modifiedPath, "utf-8");
console.log(`   Modified content:\n${modifiedContent.split("\n").map(l => "   " + l).join("\n")}`);

// Verify the modifications were applied correctly
const verifyParser = new CSVParser(modifiedPath);
const verifyRows: Record<string, string>[] = [];
for (const row of verifyParser) {
  verifyRows.push({
    name: row.get("name") ?? "",
    age: row.get("age") ?? "",
    city: row.get("city") ?? "",
  });
}
verifyParser.close();

console.log(`\n   Verification (parsed modified file):`);
for (const row of verifyRows) {
  console.log(`   - ${row.name}, ${row.age}, ${row.city}`);
}

// Check expected changes
const hasAliceAgeChanged = verifyRows.some(r => r.name === "Alice" && r.age === "31");
const hasBobNameChanged = verifyRows.some(r => r.name === "Robert");
const hasCharlieDeleted = !verifyRows.some(r => r.name === "Charlie");
const hasDianaInserted = verifyRows.some(r => r.name === "Diana" && r.city === "Seattle");

console.log(`\n   Verification results:`);
console.log(`   - Alice age changed to 31: ${hasAliceAgeChanged}`);
console.log(`   - Bob renamed to Robert: ${hasBobNameChanged}`);
console.log(`   - Charlie deleted: ${hasCharlieDeleted}`);
console.log(`   - Diana inserted: ${hasDianaInserted}`);

// 9. Copy-on-write: save to same file (overwrite)
console.log("\n9. Copy-on-Write - save to same file:");
const overwritePath = "/tmp/phase5-test-overwrite.csv";
cleanup(overwritePath);

// Create initial file
const setupWriter2 = new CSVWriter(overwritePath);
setupWriter2.writeHeader(["id", "status"]);
setupWriter2.writeRow(["1", "active"]);
setupWriter2.writeRow(["2", "active"]);
setupWriter2.close();

// Modify and save back
const parser2 = new CSVParser(overwritePath, { writable: true });
parser2.setCell(0, "status", "inactive");
parser2.save(); // Save to same file
parser2.close();

const overwrittenContent = readFileSync(overwritePath, "utf-8");
console.log(`   After modifying and saving to same file:`);
console.log(`${overwrittenContent.split("\n").map(l => "   " + l).join("\n")}`);

// 10. Discard changes
console.log("\n10. Discard Changes:");
const parser3 = new CSVParser(overwritePath, { writable: true });
parser3.setCell(0, "status", "will-be-discarded");
console.log(`   Before discard: ${parser3.modificationCount} modifications`);
console.log(`   Modified value: ${parser3.getCell(0, "status")}`);

parser3.discardChanges();
console.log(`   After discard: ${parser3.modificationCount} modifications`);
parser3.close();

// 11. Error handling: non-writable parser
console.log("\n11. Error Handling - Non-writable Parser:");
const nonWritableParser = new CSVParser(overwritePath);
try {
  nonWritableParser.setCell(0, 0, "test");
  console.log(`   ERROR: Should have thrown!`);
} catch (err: any) {
  console.log(`   Correctly threw error: ${err.message}`);
}
nonWritableParser.close();

// Cleanup test files
cleanup(outputPath1, outputPath2, outputPath3, testDataPath, modifiedPath, overwritePath);

console.log("\n=== Phase 5 Tests Complete ===");
