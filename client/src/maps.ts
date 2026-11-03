const ASSETS = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images";

const NAMES: Record<string, string> = {
  de_mirage: "Mirage",
  de_inferno: "Inferno",
  de_nuke: "Nuke",
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  de_vertigo: "Vertigo",
  de_overpass: "Overpass",
  de_dust2: "Dust II",
  de_train: "Train",
  de_cache: "Cache",
};

export const MAPS = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_vertigo", "de_overpass", "de_dust2", "de_train", "de_cache"];

export const DEFAULT_POOL = MAPS.slice(0, 7);

export const mapName = (id: string) => NAMES[id] ?? id.replace(/^de_/, "").replace(/^\w/, (c) => c.toUpperCase());

export const mapIcon = (id: string) => `${ASSETS}/${id}.png`;

export const mapThumb = (id: string, n = 1) => `${ASSETS}/thumbs/${id}_${n}_png.png`;
