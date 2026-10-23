// Heavy export dependencies, built into a separate lib.js that the MD to PDF
// feature loads on the first export. Keeping them out of main.js keeps
// Obsidian's startup read/parse of this plugin small.
export { default as jsPDF } from "jspdf";
export { default as html2canvas } from "html2canvas-pro";
