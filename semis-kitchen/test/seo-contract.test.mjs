import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readBuiltFile = async (name) => {
  try {
    return await readFile(path.join(projectRoot, "dist", name), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
};

const html = await readBuiltFile("index.html");
const robots = await readBuiltFile("robots.txt");
const sitemap = await readBuiltFile("sitemap.xml");
const legalContentPath = path.join(projectRoot, "src", "content", "legalContent.js");
const legalContent = await import(pathToFileURL(legalContentPath)).catch(() => ({}));

assert.match(html, /<html\s+lang="en"/i, "The public document must declare its language");
assert.match(html, /<meta\s+name="description"\s+content="[^"]+"/i, "The homepage must have a meta description");
assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/semiskitchen\.in\/"/i, "The homepage must use the production canonical URL");
assert.match(html, /<meta\s+property="og:title"\s+content="[^"]+"/i, "The homepage must provide an Open Graph title");
assert.match(html, /<meta\s+property="og:image"\s+content="https:\/\/semiskitchen\.in\/[^\"]+"/i, "The Open Graph image must be an absolute production URL");
assert.match(html, /<script\s+type="application\/ld\+json">[\s\S]*"@type"\s*:\s*"Restaurant"[\s\S]*<\/script>/i, "The homepage must provide Restaurant structured data");

assert.match(robots, /^User-agent:\s*\*$/mi, "robots.txt must address all crawlers");
assert.match(robots, /^Disallow:\s*\/nashi\s*$/mi, "The admin route must be excluded from crawling");
assert.match(robots, /^Sitemap:\s*https:\/\/semiskitchen\.in\/sitemap\.xml\s*$/mi, "robots.txt must advertise the production sitemap");

assert.match(sitemap, /<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/i, "sitemap.xml must use the sitemap protocol");
assert.match(sitemap, /<loc>https:\/\/semiskitchen\.in\/<\/loc>/i, "The homepage must be present in the sitemap");
assert.match(sitemap, /<loc>https:\/\/semiskitchen\.in\/privacy<\/loc>/i, "The privacy page must be present in the sitemap");
assert.match(sitemap, /<loc>https:\/\/semiskitchen\.in\/terms<\/loc>/i, "The terms page must be present in the sitemap");
assert.doesNotMatch(sitemap, /\/nashi/i, "The admin route must never appear in the sitemap");

assert.ok(legalContent.privacySections?.length >= 6, "The privacy notice must explain the site's material data practices");
assert.ok(legalContent.termsSections?.length >= 6, "The customer terms must explain the material ordering conditions");
assert.match(JSON.stringify(legalContent.privacySections ?? []), /OpenStreetMap/i, "The privacy notice must disclose map-service data sharing");
assert.match(JSON.stringify(legalContent.privacySections ?? []), /indefinitely/i, "The privacy notice must disclose the approved retention period");
assert.match(JSON.stringify(legalContent.termsSections ?? []), /delivery charge/i, "The terms must explain how delivery charges are confirmed");
assert.match(JSON.stringify(legalContent.termsSections ?? []), /cross-contact/i, "The terms must disclose the allergen cross-contact limitation");

console.log("SEO contract verified against the production build output.");
