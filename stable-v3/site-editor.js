/* Stable Version 3 test-copy safeguard.
   The production visual editor reads/writes the live website_page_content table.
   This no-op intentionally prevents the copied pages from loading or saving production layout config. */
console.info("EVE Stable Version 3: production visual-editor backend disabled in test copy.");
