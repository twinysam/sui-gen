# Sui-Gen (歲-Gen)

![Sui-Gen screenshot](screenshot.png)

**Sui-Gen** is a precision lunisolar calendar generator designed for accuracy and ease of use. It allows developers, researchers, and enthusiasts to generate structured datasets of Lunar New Year metadata across centuries without relying on heavy runtime libraries.

Simply select a year range, choose your output format, and export a reliable, precomputed calendar table ready for integration into your applications.

## Key Features & Technical Details

Sui-Gen goes beyond simple date conversion. It computes a rich set of traditional calendrical attributes for each lunar year found within the specified Gregorian range:

*   **Precise Chinese New Year (CNY) Dates**: Calculates the exact Gregorian date for the first day of the first lunar month.
*   **Zodiac Animals (Sheng Xiao)**: Traditional animal sign for the year (e.g., Dragon, Snake).
*   **Wu Xing Elements**: The elemental association (Metal, Wood, Water, Fire, Earth) derived from the Heavenly Stem.
*   **Ganzhi (Stem-Branch) Cycle**: The sexagenary cycle designation (e.g., 甲辰).
*   **Leap Month Logic**: Identifies if a year contains a leap month (Runyue) and returns its index, or `null` if none exists.
*   **Solar Terms (Jie Qi)**: Specifically calculates the **Lìchūn (Start of Spring)** date, checking Solar Feb 3–5 to ensure accuracy even when it falls before the Lunar New Year.
*   **Astronomical Accuracy**: Uses high-precision algorithms for the **New Moon (Shuo)** timestamp, provided in UTC ISO-8601 format.

## About the Data

The astronomical data powering Sui-Gen was pre-computed using [Skyfield](https://rhodesmill.org/skyfield/), a Python astronomy library, against NASA's Jet Propulsion Laboratory planetary ephemerides, specifically [DE440 and DE441](https://ssd.jpl.nasa.gov/doc/de440_de441.html), the same numerical integration models used for interplanetary spacecraft navigation.

New moon moments and solar term crossings (including 立春 Start of Spring and 冬至 Winter Solstice) were computed by finding the precise instants at which the apparent geocentric ecliptic longitude of the Sun and Moon reach specific values, converted to Beijing Time (UTC+8) in accordance with the astronomical definition of the Chinese lunisolar calendar.

DE440 (covering 1550-2648 CE) was used where available, as it includes modelling of the Moon's liquid core and mantle coupling for higher accuracy. DE441 (covering 619-17190 CE) was used for the historical and far-future ranges outside DE440's coverage.

All calendar fields (Chinese New Year date, leap month, and year length) are derived directly from these astronomical moments rather than from lookup tables or approximations.

Accuracy is sub-second for dates within the DE440 range. For dates outside this range, accuracy degrades gradually due to the uncertainty in ΔT (the difference between Terrestrial Time and Universal Time), which grows unpredictably over millennia as Earth's rotation rate cannot be precisely extrapolated. See the reliability tiers for field-by-field accuracy ranges.

Zodiac, element, and Ganzhi cycle fields are computed separately via pure 12- and 60-year cycle arithmetic and are reliable for any year.

Ephemeris data courtesy of [NASA Jet Propulsion Laboratory](https://ssd.jpl.nasa.gov/doc/de440_de441.html).

### Available Precomputed Datasets

All datasets were computed using Skyfield, against NASA JPL planetary ephemerides DE440 (1550–2648 CE) and DE441 (619–17190 CE).All timestamps are given in both Terrestrial Time (TT) as Julian Day Numbers and as approximate UTC.

#### [`sui-gen-jpl-source_619-17190.json`](sui-gen-jpl-source_619-17190.json)
**Chinese Lunisolar Calendar Dataset — 619 to 17190 CE**
One record per lunar year containing:
* `gregorian_year` — the Gregorian year in which Chinese New Year falls
* `cnyDate` — Chinese New Year date in Beijing Time (UTC+8)
* `newMoonUtc` — precise UTC timestamp of the new moon marking Chinese New Year
* `liChun` — date of 立春 (Start of Spring), the first solar term of the traditional agricultural calendar
* `leapMonth` — the leap month number if the year contains one, otherwise null
* `yearLength` — length of the lunar year in days (354, 355, or 384)
* `zodiac`, `element`, `ganzhi` — cyclical calendar attributes
* `ephemeris` — which JPL ephemeris was used for that year (DE440 or DE441)

#### [`sui-gen-solar-terms-619-17190.json`](sui-gen-solar-terms-619-17190.json)
**All 24 Solar Terms — 619 to 17190 CE**
One record per Gregorian year containing all 24 solar terms (節氣, Jiéqì). Each term includes:
* `index` — ecliptic longitude index (0–23, where index = ⌊solar longitude / 15°⌋ mod 24)
* `zh` — traditional Chinese name
* `pinyin` — romanized pronunciation
* `en` — English name
* `date` — Beijing date (UTC+8)
* `tt` — Terrestrial Time Julian Day Number

#### [`sui-gen-newmoon-tt-619-17190.json`](sui-gen-newmoon-tt-619-17190.json)
**New Moon Moments in Terrestrial Time — 619 to 17190 CE**
One record per lunar conjunction (~204,964 total) containing:
* `tt` — Terrestrial Time Julian Day Number (authoritative field)
* `utcApprox` — UTC approximation
* `beijingDate` — local date in Beijing Time (UTC+8)

*Note on TT vs UTC*: Terrestrial Time is a uniform atomic timescale unaffected by Earth's irregular rotation. Converting TT to UTC requires ΔT — the measured difference between the two timescales — which is known precisely for historical and near-future dates but must be extrapolated for dates far in the future. For applications requiring maximum long-term precision, use the `tt` field directly and apply your own ΔT conversion using the best available data at the time of use.

### Accuracy & Reliability

Sui-Gen's pre-computed data is built from JPL DE440/DE441 ephemerides. For dates beyond the pre-computed range, the [lunar-javascript](https://github.com/6tail/lunar-javascript) library is used as a fallback.

#### Supported Range: CE 619 to CE 17,190
Fields are categorized into three reliability tiers:

| Field Type | Reliability | Valid Range | Notes |
| :--- | :--- | :--- | :--- |
| **Cycle Fields** | **100% Reliable** | **Infinite** | Fields like *Zodiac*, *Elements*, and *Ganzhi* are calculated via pure arithmetic and remain scientifically accurate for any year, past or future. |
| **Calendar Dates** | **Sub-second Precision** | **CE 619 - 17,190** | *CNY*, *Li Chun*, *Year Length*, and *Leap Month* are derived from pre-computed DE440/DE441 ephemeris data. |
| **Precise Times** | **Approximate** | **CE 2050 - 2300** | Due to ΔT (Earth's rotational braking), precise times like *New Moon UTC* become approximate after 2050 (± minutes) and represent a "best guess" extrapolation. |

> **Scientific Basis**: Our ΔT extrapolations align with the models proposed by [Morrison & Stephenson (2004)](https://adsabs.harvard.edu/full/2004JHA....35..327M), the standard for historical astronomical timing.

#### Robustness Features
*   **Arithmetic Fallbacks**: If pre-computed data is unavailable for extreme years, the system automatically falls back to pure arithmetic for cycle fields, ensuring valid metadata generation without crashing.
*   **Smart Gating**: The UI and Worker automatically disable fields that are scientifically unsafe for the requested range (e.g., disabling *New Moon UTC* outside the ephemeris coverage).
*   **Off-Main-Thread**: All heavy lunisolar computations run in a dedicated Web Worker to keep the UI responsive.

## Output Formats
Sui-Gen supports exporting your generated dataset in multiple formats, ensuring compatibility with any data pipeline:
*   **JSON**: Standard, pretty-printed JSON array of objects.
*   **CSV**: RFC-4180 compliant, perfect for spreadsheets and data analysis.
*   **YAML**: Clean, block-style configuration format.
*   **SQL**: Ready-to-execute `INSERT INTO` statements for a relational database table (`sui_gen_cny`).
*   **Markdown**: A formatted GitHub-flavored table for documentation.

## Dependencies
This project relies on:
*   [lunar-javascript](https://github.com/6tail/lunar-javascript) (v1.3.01) - For fallback calendar computations and cycle field info panel.
*   [Bootstrap 5](https://getbootstrap.com/) - For the responsive UI.
*   [Highlight.js](https://highlightjs.org/) - For syntax highlighting in the preview window.
*   Pre-computed astronomical data from [JPL DE440/DE441](https://ssd.jpl.nasa.gov/doc/de440_de441.html), generated via [Skyfield](https://rhodesmill.org/skyfield/).

## License
This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.
You are free to use, modify, and distribute this software under the terms of the GPL-3.0 license.
