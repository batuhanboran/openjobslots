const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { adapters } = require("./adapters");
const {
  normalizeCountryFromLocation,
  normalizeCountryName,
  normalizePosting,
  normalizePostingDate,
  normalizeRegionFromCountry,
  normalizeRemoteType,
  normalizeRemoteTypeFromEvidence,
  validatePosting
} = require("./posting");

const fixtureDir = path.join(__dirname, "fixtures");

const fixtureFileNames = fs.readdirSync(fixtureDir)
  .filter((fileName) => fileName.endsWith("-postings.json"))
  .sort();

for (const fileName of fixtureFileNames) {
  test(`${fileName} normalizes saved ATS postings`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, fileName), "utf8"));
    const atsKey = String(fixture.expected?.[0]?.ats_key || "");
    const adapter = adapters.get(atsKey);
    assert.ok(adapter, `expected adapter ${atsKey}`);

    const normalized = fixture.postings.map((posting) => adapter.normalize(posting, fixture.company));
    assert.equal(normalized.length, fixture.expected.length);

    for (let index = 0; index < fixture.expected.length; index += 1) {
      const item = normalized[index];
      const expected = fixture.expected[index];
      assert.equal(validatePosting(item).ok, true);
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(item[key], value, `${key} should match`);
      }
      if (item.posting_date) {
        assert.equal(Number.isFinite(item.posting_date_epoch), true);
      }
      assert.equal(item.canonical_url, item.job_posting_url);
      assert.equal(item.title, item.position_name);
      assert.equal(item.company, item.company_name);
      assert.ok(item.parser_version);
      assert.ok(item.raw_hash);
    }
  });
}

test("parser rejects postings missing URL, company, or title", () => {
  assert.equal(validatePosting(normalizePosting({ position_name: "Engineer" }, { company_name: "Acme" }, "greenhouse")).ok, false);
  assert.equal(
    validatePosting(
      normalizePosting(
        { company_name: "Acme", job_posting_url: "https://example.com/jobs/1" },
        {},
        "greenhouse"
      )
    ).ok,
    false
  );
  assert.equal(
    validatePosting(
      normalizePosting(
        { position_name: "Engineer", job_posting_url: "https://example.com/jobs/1" },
        {},
        "greenhouse"
      )
    ).ok,
    false
  );
});

test("location, country, date, and remote normalization cover common aliases", () => {
  assert.equal(normalizeCountryFromLocation("Istanbul, T\u00fcrkiye"), "Turkey");
  assert.equal(normalizeCountryFromLocation("Ankara, Turkey"), "Turkey");
  assert.equal(normalizeCountryFromLocation("Gebze, Kocaeli, Turkiye"), "Turkey");
  assert.equal(normalizeCountryFromLocation("Indianapolis, IN"), "United States");
  assert.equal(normalizeCountryFromLocation("Bengaluru, Karnataka, India"), "India");
  assert.equal(normalizeCountryFromLocation("Sydney, NSW, Australia"), "Australia");
  assert.equal(normalizeCountryFromLocation("Sao Paulo, Brazil"), "Brazil");
  assert.equal(normalizeCountryFromLocation("Dubai, UAE"), "United Arab Emirates");
  assert.equal(normalizeCountryFromLocation("Rijswijk, 2288EG, Nederland"), "Netherlands");
  assert.equal(normalizeCountryFromLocation("Wien, Osterreich"), "Austria");
  assert.equal(normalizeCountryFromLocation("Burnaby, British Columbia"), "Canada");
  assert.equal(normalizeCountryFromLocation("Washington, District of Columbia"), "United States");
  assert.equal(normalizeCountryFromLocation("Hsin Chu, Taiwan"), "Taiwan");
  assert.equal(normalizeCountryFromLocation("Ulsan"), "South Korea");
  assert.equal(normalizeCountryFromLocation("Heidelberg"), "Germany");
  assert.equal(normalizeCountryFromLocation("Carlton, Victoria"), "Australia");
  assert.equal(normalizeCountryFromLocation("049909, SG"), "Singapore");
  assert.equal(normalizeCountryFromLocation("Hebburn, GB"), "United Kingdom");
  assert.equal(normalizeCountryFromLocation("Falmouth, GB"), "United Kingdom");
  assert.equal(normalizeCountryFromLocation("IN-KL-Kozhikode (Calicut)"), "India");
  assert.equal(normalizeCountryFromLocation("IL-Tel Aviv"), "Israel");
  assert.equal(normalizeCountryFromLocation("CA-San Francisco"), "United States");
  assert.equal(normalizeCountryFromLocation("LA"), "United States");
  assert.equal(normalizeCountryFromLocation("MO"), "United States");
  assert.equal(normalizeCountryFromLocation("Mc Lean, VA"), "United States");
  assert.equal(normalizeCountryFromLocation("OK-Sand Springs-74063"), "United States");
  assert.equal(normalizeCountryFromLocation("Poipet, Cambodia"), "Cambodia");
  assert.equal(normalizeCountryFromLocation("Nairobi Area, Kenya"), "Kenya");
  assert.equal(normalizeCountryFromLocation("Accra, Greater Accra, Ghana"), "Ghana");
  assert.equal(normalizeCountryFromLocation("Cameroon, Centre, Cameroon"), "Cameroon");
  assert.equal(normalizeCountryFromLocation("San Rafael, Alajuela, Costa Rica"), "Costa Rica");
  assert.equal(normalizeCountryFromLocation("Havelock Town, Western Province, Sri Lanka"), "Sri Lanka");
  assert.equal(normalizeCountryFromLocation("Paramaribo, Suriname"), "Suriname");
  assert.equal(normalizeCountryFromLocation("Arawa, Autonomous Region of Bougainville, Papua New Guinea"), "Papua New Guinea");
  assert.equal(normalizeCountryFromLocation("ABIDJAN, Cote D'Ivoire (Ivory Coast)"), "Cote d'Ivoire");
  assert.equal(normalizeCountryFromLocation("Hamilton, Bermuda"), "Bermuda");
  assert.equal(normalizeCountryFromLocation("Road Town, Virgin Islands, British"), "British Virgin Islands");
  assert.equal(normalizeCountryFromLocation("Lome, Togo"), "Togo");
  assert.equal(normalizeCountryFromLocation("Libreville, Gabon"), "Gabon");
  assert.equal(normalizeCountryFromLocation("Yaounde, Cameroun"), "Cameroon");
  assert.equal(normalizeCountryFromLocation("R\u012bga, Latvija"), "Latvia");
  assert.equal(normalizeCountryFromLocation("Bago, Myanmar"), "Myanmar");
  assert.equal(normalizeCountryFromLocation("Skopje, Centar, Macedonia"), "North Macedonia");
  assert.equal(normalizeCountryFromLocation("Honiara, Solomon Islands"), "Solomon Islands");
  assert.equal(normalizeCountryFromLocation("Belgrade"), "Serbia");
  assert.equal(normalizeCountryFromLocation("Cluj Napoca Hexagon Office"), "Romania");
  assert.equal(normalizeCountryFromLocation("Taguig"), "Philippines");
  assert.equal(normalizeCountryFromLocation("Mandaluyong City"), "Philippines");
  assert.equal(normalizeCountryFromLocation("Riyadh"), "Saudi Arabia");
  assert.equal(normalizeCountryFromLocation("Djibouti"), "Djibouti");
  assert.equal(normalizeCountryFromLocation("Almaty, Kazakhstan"), "Kazakhstan");
  assert.equal(normalizeCountryFromLocation("Guam"), "Guam");
  assert.equal(normalizeCountryFromLocation("Ebene"), "Mauritius");
  assert.equal(normalizeRegionFromCountry("Cambodia"), "APAC");
  assert.equal(normalizeRegionFromCountry("Kenya"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Ghana"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Cameroon"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Costa Rica"), "LATAM");
  assert.equal(normalizeRegionFromCountry("Sri Lanka"), "APAC");
  assert.equal(normalizeRegionFromCountry("Saint Kitts and Nevis"), "North America");
  assert.equal(normalizeRegionFromCountry("Bermuda"), "North America");
  assert.equal(normalizeRegionFromCountry("British Virgin Islands"), "North America");
  assert.equal(normalizeRegionFromCountry("Togo"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Gabon"), "EMEA");
  assert.equal(normalizeRegionFromCountry("North Macedonia"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Mauritius"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Djibouti"), "EMEA");
  assert.equal(normalizeRegionFromCountry("Kazakhstan"), "APAC");
  assert.equal(normalizeRegionFromCountry("Guam"), "APAC");
  assert.equal(normalizeCountryName("TR"), "Turkey");
  assert.equal(normalizeCountryName("U.S."), "United States");
  assert.equal(normalizeCountryName("IN"), "India");
  assert.equal(normalizeCountryName("AUS"), "Australia");
  assert.equal(normalizeCountryName("Belgie"), "Belgium");
  assert.equal(normalizeCountryName("Brunei Darussalam"), "Brunei");
  assert.equal(normalizeCountryName("Laos"), "Laos");
  assert.equal(normalizeCountryName("Macao"), "Macao");
  assert.equal(normalizeCountryName("Monaco"), "Monaco");
  assert.equal(normalizeCountryName("Cameroun"), "Cameroon");
  assert.equal(normalizeCountryName("Latvija"), "Latvia");
  assert.equal(normalizeCountryName("中国"), "China");
  assert.equal(normalizeRemoteType("Hybrid Remote - Ankara"), "hybrid");
  assert.equal(normalizeRemoteType("Remote - EMEA"), "remote");
  assert.equal(normalizeRemoteType("Home office - Portugal"), "remote");
  assert.equal(normalizeRemoteType("Telecommute - United States"), "remote");
  assert.equal(normalizeRemoteType("Hybrid - Ankara"), "hybrid");
  assert.equal(normalizeRemoteType("On-site - Berlin"), "onsite");
  assert.equal(normalizeRemoteTypeFromEvidence("Support Engineer Indianapolis, IN", "Indianapolis, IN"), "onsite");
  assert.equal(normalizeRemoteTypeFromEvidence("Support Engineer Remote - United States", "Remote - United States"), "remote");
  assert.equal(normalizePostingDate("2026-05-06T08:00:00+03:00").epoch, 1778043600);
  assert.equal(normalizePostingDate("1778043600").epoch, 1778043600);
  assert.equal(normalizePostingDate("1778043600000").epoch, 1778043600);
  assert.equal(Number.isFinite(normalizePostingDate("Posted Today").epoch), true);
  assert.equal(Number.isFinite(normalizePostingDate("2 days ago").epoch), true);
});

test("nested ATS location objects preserve structured country fields", () => {
  const normalized = normalizePosting(
    {
      company_name: "Fixture",
      position_name: "Support Engineer",
      job_posting_url: "https://example.com/jobs/support",
      location: {
        name: "Indianapolis, IN",
        country: "United States"
      },
      isRemote: true
    },
    {},
    "bamboohr"
  );
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.region, "North America");
  assert.equal(normalized.remote_type, "remote");
  assert.match(normalized.location_text, /Indianapolis/);
  assert.match(normalized.location_text, /United States/);
});
