// Download as a spreadsheet (the owner 2026-10-21): CSV files of the hub's own lists, for Excel, Google Sheets or a
// backup he can read. Read-only; built from the data files as they are. Opens in Excel with accents intact (BOM).
import { resolvePath, readJson } from "./util.js";
import { priceOf } from "./collection.js";

const read = (p, fallback) => readJson(resolvePath(p), fallback);
export const cell = (v) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  // Leading = + - @ would run as a formula in Excel; a quote mark in front keeps it as text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (head, rows) => "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

const TABLES = {
  cards: {
    file: "Card collection",
    build: () => {
      const { cards = [] } = read("data/cards/collection.json", {});
      return csv(
        [
          "Name",
          "Set",
          "Set name",
          "Number",
          "Finish",
          "Condition",
          "Language",
          "Qty",
          "Each US$",
          "Total US$",
          "Paid",
          "Lists",
          "Rarity",
          "Type",
          "Added",
        ],
        cards.map((c) => {
          const e = priceOf(c);
          return [
            c.name,
            String(c.set || "").toUpperCase(),
            c.setName,
            c.number,
            c.finish,
            c.condition,
            c.language,
            c.qty,
            e,
            e != null ? Math.round(e * c.qty * 100) / 100 : null,
            c.paid,
            c.lists,
            c.rarity,
            c.typeLine,
            String(c.addedAt || "").slice(0, 10),
          ];
        }),
      );
    },
  },
  reading: {
    file: "Watching and reading",
    build: () => {
      const { items = [] } = read("data/reading.json", {});
      return csv(["Title", "Kind", "Status", "Where", "Progress", "Latest out", "Total", "Ended", "Your link", "Info page", "Added"],
        items.map((i) => [i.title, i.kind, i.status, i.where, i.progress, i.latest, i.total, i.ended ? "yes" : "", i.link, i.url, String(i.addedAt || "").slice(0, 10)]));
    },
  },
  matches: {
    file: "Paper matches",
    build: () => {
      const { matches = [] } = read("data/cards/paper-matches.json", {});
      return csv(["Date", "Format", "Place", "Event", "My deck", "Opponent", "Their deck", "Their colours", "Result", "Games won", "Games lost", "Games drawn", "Pod size", "On the play", "Notes"],
        matches.map((m) => [m.date, m.format, m.place, m.event, m.myDeck, m.opponent, m.oppDeck, m.oppColors, m.result, m.won, m.lost, m.drawn, m.podSize, m.onPlay == null ? "" : m.onPlay ? "yes" : "no", m.notes]));
    },
  },
  todo: {
    file: "To-do and ideas",
    build: () => {
      const { items = [] } = read("data/todo.json", {});
      return csv(["Title", "Status", "Category", "Detail", "Source", "Added", "Done"],
        items.map((t) => [t.title, t.status, t.category, t.detail, t.source, String(t.at || "").slice(0, 10), String(t.doneAt || "").slice(0, 10)]));
    },
  },
};

export function exportCsv(what) {
  const t = TABLES[what];
  if (!t) throw new Error("Unknown list.");
  return { name: `${t.file} ${new Date().toISOString().slice(0, 10)}.csv`, body: t.build() };
}
