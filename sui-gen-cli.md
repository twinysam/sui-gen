# Sui-Gen CLI

Sui-Gen CLI (`sui-gen.js`) is a Node.js command-line tool that generates highly precise Chinese Calendar data sets. It calculates exact lunar phases (New Moons) and solar terms (*Zhongqi*) by directly querying the NASA JPL Horizons API (DE440/DE441 ephemerides) and applying Yuk Tung Liu's astronomical Chinese Calendar algorithm.

This tool bypasses browser CORS limitations, allowing you to generate decades or centuries of astronomical calendar data locally.

## Prerequisites

- Node.js installed (v18+ recommended for native `fetch` support).
- Internet connection (to query the NASA JPL Horizons API).

## Usage

Run the script using Node.js from the root of the project directory:

```bash
node sui-gen.js [options]
```

### Options

| Argument | Description | Default |
| :--- | :--- | :--- |
| `--start <year>` | The starting Gregorian year for the generation range. | `1900` |
| `--end <year>` | The ending Gregorian year for the generation range. | `2100` |
| `--format <ext>` | The output file format. Supported options: `json`, `csv`, `yaml`, `sql`, `md`. | `json` |
| `--fields <list>` | Comma-separated list of fields to include in the output. Use `all` to include everything. | `all` |

### Available Fields

- `cnyDate`: The Gregorian date of Chinese New Year (YYYY-MM-DD).
- `zodiac`: The Chinese Zodiac animal for the year (e.g., Dragon).
- `element`: The Heavenly Stem element for the year (e.g., Wood).
- `ganzhi`: The Sexagenary cycle name in Chinese characters (e.g., 甲辰).
- `liChun`: The Gregorian date of the *Lichun* solar term (Start of Spring).
- `yearLength`: The number of days in the Chinese lunar year.
- `leapMonth`: The month number that is intercalary (leap), or `null` if it is a standard year.
- `newMoonUtc`: The precise UTC timestamp of the New Moon that starts the Chinese Year.

*Note: If \`--fields\` is not explicitly set to \`all\`, only the requested fields will be included in the output.*

### Hard Limits

Due to the availability bounds of the DE440/DE441 ephemerides data provided by the NASA JPL Horizons API, precise astronomical data generation is strictly limited to years between **619 CE** and **17191 CE**. 
- Generating `cnyDate`, `liChun`, `yearLength`, `leapMonth`, and `newMoonUtc` outside of this range will result in empty data fields.
- Arithmetic fields (`zodiac`, `element`, `ganzhi`) do not rely on astronomical data and can be generated indefinitely in either direction.

## Examples

**1. Generate a JSON dataset for the 21st century with all fields:**
```bash
node sui-gen.js --start 2000 --end 2099 --fields all --format json
```
*Output: `sui-gen-2000-2099.json`*

**2. Generate a CSV file containing only the Chinese New Year dates and Leap Months for a 500-year span:**
```bash
node sui-gen.js --start 1800 --end 2300 --fields cnyDate,leapMonth --format csv
```
*Output: `sui-gen-1800-2300.csv`*

**3. Generate SQL insert statements for personal dashboard database seeding:**
```bash
node sui-gen.js --start 2020 --end 2030 --fields cnyDate,zodiac,element,ganzhi --format sql
```
*Output: `sui-gen-2020-2030.sql`*

## How it Works

1. **Chunked Fetching**: When requesting large year ranges, the CLI automatically chunks the requests to the NASA JPL Horizons API into 100-year batches to prevent payload timeouts or API rate limits.
2. **Cubic Interpolation**: It requests 12-hour resolution data for the Sun and Moon's ecliptic longitudes from DE440/441 ephemerides and performs 4-point cubic interpolation to mathematically pinpoint the exact millisecond of New Moons and Solar Terms.
3. **Astronomical Timelines**: It constructs a continuous timeline, finds consecutive Winter Solstices, counts New Moons between them, and assigns leap months by identifying the first lunar month without a principal solar term (*Zhongqi*). This eliminates the reliance on simple cycle-based estimations.
