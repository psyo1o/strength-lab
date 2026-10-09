import { writeSeedJson } from "../src/lib/db/seed";

const file = writeSeedJson();
console.log("Wrote", file);
