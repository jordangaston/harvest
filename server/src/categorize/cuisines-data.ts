// Authored cuisine hierarchy — the SINGLE source of truth that drives both VOCAB.cuisine
// and the seeded 'cuisines' table (seed:cuisines). Embedded as a TS module (not a JSON import)
// so it survives the workflow-step bundler; a JSON import ('with { type: json }') is externalized
// by rolldown in the WDK per-step bundle and then rejected by Node's import-attributes loader.
import type { CuisineNode } from './cuisines.js';

export const CUISINES_DATA: CuisineNode[] = [
  {
    "slug": "american",
    "label": "American",
    "parent_slug": null
  },
  {
    "slug": "mexican",
    "label": "Mexican",
    "parent_slug": null
  },
  {
    "slug": "caribbean",
    "label": "Caribbean",
    "parent_slug": null
  },
  {
    "slug": "peruvian",
    "label": "Peruvian",
    "parent_slug": null
  },
  {
    "slug": "brazilian",
    "label": "Brazilian",
    "parent_slug": null
  },
  {
    "slug": "argentine",
    "label": "Argentine",
    "parent_slug": null
  },
  {
    "slug": "italian",
    "label": "Italian",
    "parent_slug": null
  },
  {
    "slug": "french",
    "label": "French",
    "parent_slug": null
  },
  {
    "slug": "spanish",
    "label": "Spanish",
    "parent_slug": null
  },
  {
    "slug": "greek",
    "label": "Greek",
    "parent_slug": null
  },
  {
    "slug": "mediterranean",
    "label": "Mediterranean",
    "parent_slug": null
  },
  {
    "slug": "german",
    "label": "German",
    "parent_slug": null
  },
  {
    "slug": "british",
    "label": "British",
    "parent_slug": null
  },
  {
    "slug": "eastern_european",
    "label": "Eastern European",
    "parent_slug": null
  },
  {
    "slug": "nordic",
    "label": "Nordic",
    "parent_slug": null
  },
  {
    "slug": "middle_eastern",
    "label": "Middle Eastern",
    "parent_slug": null
  },
  {
    "slug": "north_african",
    "label": "North African",
    "parent_slug": null
  },
  {
    "slug": "ethiopian",
    "label": "Ethiopian",
    "parent_slug": null
  },
  {
    "slug": "west_african",
    "label": "West African",
    "parent_slug": null
  },
  {
    "slug": "indian",
    "label": "Indian",
    "parent_slug": null
  },
  {
    "slug": "thai",
    "label": "Thai",
    "parent_slug": null
  },
  {
    "slug": "vietnamese",
    "label": "Vietnamese",
    "parent_slug": null
  },
  {
    "slug": "chinese",
    "label": "Chinese",
    "parent_slug": null
  },
  {
    "slug": "japanese",
    "label": "Japanese",
    "parent_slug": null
  },
  {
    "slug": "korean",
    "label": "Korean",
    "parent_slug": null
  },
  {
    "slug": "filipino",
    "label": "Filipino",
    "parent_slug": null
  },
  {
    "slug": "indonesian",
    "label": "Indonesian",
    "parent_slug": null
  },
  {
    "slug": "malaysian",
    "label": "Malaysian",
    "parent_slug": null
  },
  {
    "slug": "southern",
    "label": "Southern",
    "parent_slug": "american"
  },
  {
    "slug": "southwestern",
    "label": "Southwestern",
    "parent_slug": "american"
  },
  {
    "slug": "new_england",
    "label": "New England",
    "parent_slug": "american"
  },
  {
    "slug": "midwestern",
    "label": "Midwestern",
    "parent_slug": "american"
  },
  {
    "slug": "californian",
    "label": "Californian",
    "parent_slug": "american"
  },
  {
    "slug": "hawaiian",
    "label": "Hawaiian",
    "parent_slug": "american"
  },
  {
    "slug": "floribbean",
    "label": "Floribbean",
    "parent_slug": "american"
  },
  {
    "slug": "baja",
    "label": "Baja",
    "parent_slug": "mexican"
  },
  {
    "slug": "oaxacan",
    "label": "Oaxacan",
    "parent_slug": "mexican"
  },
  {
    "slug": "yucatecan",
    "label": "Yucatecan",
    "parent_slug": "mexican"
  },
  {
    "slug": "lebanese",
    "label": "Lebanese",
    "parent_slug": "middle_eastern"
  },
  {
    "slug": "turkish",
    "label": "Turkish",
    "parent_slug": "middle_eastern"
  },
  {
    "slug": "persian",
    "label": "Persian",
    "parent_slug": "middle_eastern"
  },
  {
    "slug": "moroccan",
    "label": "Moroccan",
    "parent_slug": "north_african"
  },
  {
    "slug": "north_indian",
    "label": "North Indian",
    "parent_slug": "indian"
  },
  {
    "slug": "south_indian",
    "label": "South Indian",
    "parent_slug": "indian"
  },
  {
    "slug": "punjabi",
    "label": "Punjabi",
    "parent_slug": "indian"
  },
  {
    "slug": "sichuan",
    "label": "Sichuan",
    "parent_slug": "chinese"
  },
  {
    "slug": "cantonese",
    "label": "Cantonese",
    "parent_slug": "chinese"
  },
  {
    "slug": "hunan",
    "label": "Hunan",
    "parent_slug": "chinese"
  },
  {
    "slug": "cajun",
    "label": "Cajun",
    "parent_slug": "southern"
  },
  {
    "slug": "creole",
    "label": "Creole",
    "parent_slug": "southern"
  },
  {
    "slug": "soul_food",
    "label": "Soul food",
    "parent_slug": "southern"
  },
  {
    "slug": "lowcountry",
    "label": "Lowcountry",
    "parent_slug": "southern"
  },
  {
    "slug": "tex_mex",
    "label": "Tex-Mex",
    "parent_slug": "southwestern"
  }
];
