function stringProperty(name: string, value: string) {
  return { name, type: "string", value } as const;
}

const TILE_SIZE = 16;
const OFFICE_LEFT = 96;
const OFFICE_TOP = 64;
const OFFICE_WIDTH = 512;
const OFFICE_HEIGHT = 544;
const OFFICE_RIGHT_MARGIN = 96;
const OFFICE_BOTTOM_MARGIN = 64;
const MAP_WIDTH = (OFFICE_LEFT + OFFICE_WIDTH + OFFICE_RIGHT_MARGIN) / TILE_SIZE;
const MAP_HEIGHT = (OFFICE_TOP + OFFICE_HEIGHT + OFFICE_BOTTOM_MARGIN) / TILE_SIZE;

let objectId = 1;

function nextId(): number {
  const id = objectId;
  objectId += 1;
  return id;
}

function zone(name: string, type: string, x: number, y: number, width: number, height: number, accent: string, summary: string) {
  return {
    id: nextId(),
    name,
    type,
    x,
    y,
    width,
    height,
    properties: [
      stringProperty("accent", accent),
      stringProperty("summary", summary),
    ],
  };
}

function officeX(value: number): number {
  return OFFICE_LEFT + value;
}

function officeY(value: number): number {
  return OFFICE_TOP + value;
}

function slot(
  name: string,
  type: string,
  x: number,
  y: number,
  zoneName: string,
  extraProperties: Array<ReturnType<typeof stringProperty>> = [],
) {
  return {
    id: nextId(),
    name,
    type,
    x,
    y,
    point: true,
    properties: [
      stringProperty("zone", zoneName),
      ...extraProperties,
    ],
  };
}

function blockedRect(x: number, y: number, width: number, height: number) {
  return {
    id: nextId(),
    x,
    y,
    width,
    height,
  };
}

function prop(
  gid: number,
  x: number,
  y: number,
  width: number,
  height: number,
  properties: Array<ReturnType<typeof stringProperty>> = [],
) {
  return {
    id: nextId(),
    gid,
    x,
    y,
    width,
    height,
    properties,
  };
}

export const missionOfficeFallbackData = {
  compressionlevel: -1,
  height: MAP_HEIGHT,
  infinite: false,
  layers: [
    {
      id: 1,
      name: "zones",
      type: "objectgroup",
      draworder: "topdown",
      opacity: 1,
      visible: true,
      objects: [
        zone(
          "Bullpen Floor",
          "work",
          officeX(56),
          officeY(56),
          368,
          256,
          "#8fd2ff",
          "Main engineering floor with paired desks and clear central walk lanes.",
        ),
        zone(
          "Collab Room",
          "meeting",
          officeX(80),
          officeY(352),
          176,
          128,
          "#ffe08c",
          "Soft-seating collaboration room for reviews, planning, and pair sessions.",
        ),
        zone(
          "Executive Office",
          "lead",
          officeX(336),
          officeY(384),
          128,
          112,
          "#d0b2ff",
          "Private leadership office for escalations, approvals, and quieter work.",
        ),
        zone(
          "Support Nook",
          "support",
          officeX(384),
          officeY(40),
          112,
          248,
          "#8ce6d1",
          "Support and connector corner with a visible quick-help lane beside the utilities wall.",
        ),
        zone(
          "Entry Hall",
          "entry",
          officeX(16),
          officeY(48),
          48,
          240,
          "#9cc8ff",
          "Arrival corridor and handoff path into the main floor.",
        ),
      ],
    },
    {
      id: 2,
      name: "props",
      type: "objectgroup",
      draworder: "topdown",
      opacity: 1,
      visible: true,
      objects: [
        prop(200, OFFICE_LEFT, OFFICE_TOP + OFFICE_HEIGHT, OFFICE_WIDTH, OFFICE_HEIGHT, [
          stringProperty("depth", "background"),
          stringProperty("filter", "none"),
        ]),
      ],
    },
    {
      id: 3,
      name: "blocked",
      type: "objectgroup",
      draworder: "topdown",
      opacity: 1,
      visible: true,
      objects: [
        blockedRect(0, 0, OFFICE_LEFT, MAP_HEIGHT * TILE_SIZE),
        blockedRect(OFFICE_LEFT + OFFICE_WIDTH, 0, OFFICE_RIGHT_MARGIN, MAP_HEIGHT * TILE_SIZE),
        blockedRect(OFFICE_LEFT, 0, OFFICE_WIDTH, OFFICE_TOP),
        blockedRect(OFFICE_LEFT, OFFICE_TOP + OFFICE_HEIGHT, OFFICE_WIDTH, OFFICE_BOTTOM_MARGIN),
        blockedRect(officeX(0), officeY(192), 96, 144),
        blockedRect(officeX(112), officeY(96), 64, 80),
        blockedRect(officeX(176), officeY(96), 176, 96),
        blockedRect(officeX(64), officeY(224), 384, 96),
        blockedRect(officeX(64), officeY(336), 48, 96),
        blockedRect(officeX(304), officeY(336), 32, 176),
      ],
    },
    {
      id: 4,
      name: "slots",
      type: "objectgroup",
      draworder: "topdown",
      opacity: 1,
      visible: true,
      objects: [
        slot("Collab Room", "meeting", officeX(152), officeY(424), "Collab Room"),
        slot("Collab Room", "meeting", officeX(184), officeY(424), "Collab Room"),
        slot("Collab Room", "meeting", officeX(216), officeY(424), "Collab Room"),
        slot("Collab Room", "meeting", officeX(152), officeY(456), "Collab Room"),
        slot("Collab Room", "meeting", officeX(184), officeY(456), "Collab Room"),
        slot("Collab Room", "meeting", officeX(216), officeY(456), "Collab Room"),

        slot("Bullpen Floor", "desk", officeX(144), officeY(208), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(208), officeY(208), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(272), officeY(208), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(336), officeY(208), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(160), officeY(328), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(224), officeY(328), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(288), officeY(328), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(384), officeY(328), "Bullpen Floor"),
        slot("Bullpen Floor", "desk", officeX(464), officeY(272), "Bullpen Floor"),

        slot("Entry Hall", "entry", officeX(48), officeY(144), "Entry Hall"),
        slot("Entry Hall", "entry", officeX(48), officeY(176), "Entry Hall"),
        slot("Entry Hall", "entry", officeX(272), officeY(352), "Entry Hall"),
        slot("Entry Hall", "entry", officeX(288), officeY(352), "Entry Hall"),

        slot("Executive Office", "lead", officeX(368), officeY(448), "Executive Office"),
        slot("Executive Office", "lead", officeX(416), officeY(448), "Executive Office"),
        slot("Executive Office", "lead", officeX(392), officeY(488), "Executive Office"),

        slot("Support Nook", "support", officeX(416), officeY(208), "Support Nook"),
        slot("Support Nook", "support", officeX(448), officeY(224), "Support Nook"),
        slot("Support Nook", "support", officeX(464), officeY(256), "Support Nook"),

        slot("Hallway", "overflow", officeX(176), officeY(208), "Hallway"),
        slot("Hallway", "overflow", officeX(224), officeY(208), "Hallway"),
        slot("Hallway", "overflow", officeX(352), officeY(208), "Hallway"),
        slot("Hallway", "overflow", officeX(176), officeY(336), "Hallway"),
        slot("Hallway", "overflow", officeX(224), officeY(336), "Hallway"),
        slot("Hallway", "overflow", officeX(352), officeY(336), "Hallway"),
        slot("Hallway", "overflow", officeX(416), officeY(336), "Hallway"),
        slot("Hallway", "overflow", officeX(128), officeY(336), "Hallway"),

        slot("Support Nook", "special", officeX(448), officeY(224), "Support Nook", [
          stringProperty("agentId", "charlie"),
        ]),
      ],
    },
  ],
  nextlayerid: 5,
  nextobjectid: objectId,
  orientation: "orthogonal",
  properties: [
    stringProperty("title", "Modern Operations Floor"),
    stringProperty("description", "Structured office floor built from the modern-office pack with desk banks, collaboration rooms, and clean agent slots."),
    stringProperty("theme", "Pixel-authored modern office"),
  ],
  renderorder: "right-down",
  tiledversion: "1.11.0",
  tileheight: 16,
  tilesets: [
    {
      firstgid: 200,
      name: "modern-office-layout",
      tilewidth: 512,
      tileheight: 544,
      tilecount: 1,
      columns: 0,
      tiles: [
        {
          id: 0,
          image: "6_Office_Designs/Office_Design_2.png",
          imagewidth: 512,
          imageheight: 544,
        },
      ],
    },
  ],
  tilewidth: 16,
  type: "map",
  version: "1.10",
  width: MAP_WIDTH,
};
