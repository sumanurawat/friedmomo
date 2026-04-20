/**
 * @typedef {Object} DialogueLine
 * @property {string} character
 * @property {string} line
 */

/**
 * @typedef {Object} Scene
 * @property {string} id
 * @property {string} sceneNumber
 * @property {string} title
 * @property {string} location
 * @property {string} time
 * @property {string} visualDescription
 * @property {string} action
 * @property {DialogueLine[]} dialogue
 * @property {string} mood
 * @property {string} storyFunction
 * @property {string[]} characterIds
 * @property {string[]} locationIds
 * @property {string|null} imageUrl
 * @property {string} imagePrompt
 * @property {string} imagePromptHash
 * @property {string} imageStatus
 * @property {string} imageError
 * @property {string|null} imageUpdatedAt
 * @property {string} imageProvider
 * @property {string} imageModelResolved
 * @property {string|null} imageAttemptedAt
 * @property {number|null} imageLatencyMs
 * @property {string} imageDiagnosticCode
 * @property {string} imageDiagnosticMessage
 * @property {string} imagePromptPreview
 */

/**
 * @typedef {Object} Sequence
 * @property {number} number
 * @property {string} title
 * @property {Scene[]} scenes
 */

/**
 * @typedef {Object} Act
 * @property {number} number
 * @property {string} title
 * @property {Sequence[]} sequences
 */

/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} visualPromptDescription
 * @property {string} role
 * @property {string} firstAppearance
 * @property {string} color
 * @property {string[]} tags
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} sourceStoryId
 * @property {string} userId
 */

/**
 * @typedef {Object} Location
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} visualPromptDescription
 * @property {string} mood
 * @property {string[]} tags
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} sourceStoryId
 * @property {string} userId
 */

/**
 * @typedef {Object} StoryBeats
 * @property {string|null} openingImage
 * @property {string|null} statusQuo
 * @property {string|null} incitingIncident
 * @property {string|null} lockIn
 * @property {string|null} midpoint
 * @property {string|null} crisis
 * @property {string|null} climax
 * @property {string|null} resolution
 */

/**
 * @typedef {Object} Storyboard
 * @property {Act[]} acts
 * @property {StoryBeats} storyBeats
 */

/**
 * @typedef {Object} Entities
 * @property {Character[]} characters
 * @property {Location[]} locations
 */

/**
 * @typedef {Object} StoryEntityLinks
 * @property {string} storyId
 * @property {string[]} characterIds
 * @property {string[]} locationIds
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'user'|'assistant'} role
 * @property {string} content
 * @property {string} timestamp
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} userId
 * @property {string} name
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {ChatMessage[]} messages
 * @property {Storyboard} storyboard
 * @property {Entities} entities
 */

export function createEmptyStoryboard() {
  return {
    acts: [
      {
        number: 1,
        title: 'SETUP',
        sequences: [
          { number: 1, title: 'Status Quo + Inciting Incident', scenes: [] },
          { number: 2, title: 'Reaction + Lock-In', scenes: [] },
        ],
      },
      {
        number: 2,
        title: 'CONFRONTATION',
        sequences: [
          { number: 1, title: 'New World / First Attempts', scenes: [] },
          { number: 2, title: 'Midpoint Shift / Revelation', scenes: [] },
          { number: 3, title: 'Escalation / Complications', scenes: [] },
          { number: 4, title: 'Crisis / Low Point', scenes: [] },
        ],
      },
      {
        number: 3,
        title: 'RESOLUTION',
        sequences: [
          { number: 1, title: 'Climax / Final Confrontation', scenes: [] },
          { number: 2, title: 'Denouement / New Normal', scenes: [] },
        ],
      },
    ],
    storyBeats: {
      openingImage: null,
      statusQuo: null,
      incitingIncident: null,
      lockIn: null,
      midpoint: null,
      crisis: null,
      climax: null,
      resolution: null,
    },
  };
}

export function createEmptyEntities() {
  return {
    characters: [],
    locations: [],
  };
}

export function createProject(name, userId = 'local_user') {
  const now = new Date().toISOString();
  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId,
    name: name || 'Untitled Story',
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: 'assistant',
        content:
          "What story are we building? Give me a premise, a genre, a vibe — or just a title if it's a classic. I'll start setting up your characters, world, and sequence structure right away.",
        timestamp: now,
      },
    ],
    storyboard: createEmptyStoryboard(),
    entities: createEmptyEntities(),
  };
}

export function createSeedProject(name, userId = 'local_user') {
  const now = new Date().toISOString();
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  function scene(n, title, location, time, visual, action, mood) {
    return {
      id: `scene_seed_${n}`,
      sceneNumber: '',
      title,
      location,
      time,
      visualDescription: visual,
      action,
      dialogue: [],
      mood,
      storyFunction: '',
      characterIds: [],
      locationIds: [],
      imageUrl: null,
      imagePrompt: '',
      imagePromptHash: '',
      imageStatus: 'idle',
      imageError: '',
      imageUpdatedAt: null,
      imageProvider: '',
      imageModelResolved: '',
      imageAttemptedAt: null,
      imageLatencyMs: null,
      imageDiagnosticCode: '',
      imageDiagnosticMessage: '',
      imagePromptPreview: '',
    };
  }

  const storyboard = {
    acts: [
      {
        number: 1,
        title: 'SETUP',
        sequences: [
          {
            number: 1,
            title: 'Status Quo + Inciting Incident',
            scenes: [
              scene(1, 'Dawn Patrol', 'City rooftop', 'Dawn', 'Detective silhouetted against a pink sunrise, scanning the skyline.', 'She adjusts her earpiece and checks the street below.', 'tense'),
              scene(2, 'The Call', 'Police precinct bullpen', 'Morning', 'Busy open-plan office, rain streaking the windows.', 'Her phone rings — a number she thought she deleted.', 'uneasy'),
            ],
          },
          {
            number: 2,
            title: 'Reaction + Lock-In',
            scenes: [
              scene(3, 'Old Wound', 'Interrogation room', 'Day', 'Dim fluorescent light, two chairs facing each other.', 'She slides a photograph across the table without a word.', 'cold'),
              scene(4, 'No Choice', 'Parking garage', 'Night', 'Low angle on headlights cutting through exhaust fog.', 'She pops the trunk — the dossier is there. She takes it.', 'resigned'),
            ],
          },
        ],
      },
      {
        number: 2,
        title: 'CONFRONTATION',
        sequences: [
          {
            number: 1,
            title: 'New World / First Attempts',
            scenes: [
              scene(5, 'Safe House', 'Abandoned warehouse loft', 'Day', 'Maps and photos pinned to a corkboard, overlapping timelines.', 'She draws a red line connecting two names.', 'focused'),
              scene(6, 'Tail Job', 'Crowded market street', 'Golden hour', 'Subject weaves through stalls; she follows fifteen paces behind.', 'She snaps covert photos while pretending to browse fabric.', 'suspenseful'),
            ],
          },
          {
            number: 2,
            title: 'Midpoint Shift / Revelation',
            scenes: [
              scene(7, 'The Leak', 'Encrypted chat on laptop', 'Night', 'Screen glow on her face, message appearing character by character.', 'She reads it twice, jaw tightening.', 'dread'),
              scene(8, 'Caught Out', 'Hotel corridor', 'Night', 'She rounds a corner and stops. He was waiting.', 'They stare at each other — two people who shouldn\'t know each other.', 'shock'),
            ],
          },
          {
            number: 3,
            title: 'Escalation / Complications',
            scenes: [
              scene(9, 'Bad Alliance', 'Rooftop bar', 'Dusk', 'City glitters below, both nursing untouched drinks.', 'She slides her burner across the table. "Call me if you want to live."', 'uneasy alliance'),
              scene(10, 'Car Chase', 'Downtown expressway', 'Night', 'Rain-slicked streets, pursuit vehicle closing fast.', 'She yanks the wheel hard, tyres screaming across three lanes.', 'adrenaline'),
            ],
          },
          {
            number: 4,
            title: 'Crisis / Low Point',
            scenes: [
              scene(11, 'Burned', 'Diner booth', 'Pre-dawn', 'She sits across from her handler, badge removed, placed on the table.', '"You\'re on your own from here."', 'betrayal'),
              scene(12, 'Rock Bottom', 'Rain-soaked alley', 'Night', 'She leans against the wall, soaked through, alone.', 'She checks the dossier one final time and makes her decision.', 'despair into resolve'),
            ],
          },
        ],
      },
      {
        number: 3,
        title: 'RESOLUTION',
        sequences: [
          {
            number: 1,
            title: 'Climax / Final Confrontation',
            scenes: [
              scene(13, 'The Exchange', 'Container port', 'Dead of night', 'Cranes loom, containers stacked like monoliths, one light source.', 'She steps into the light with the dossier raised.', 'electrifying'),
              scene(14, 'One Shot', 'Container port catwalk', 'Night', 'She fires once. Echo. Silence.', 'A figure falls. She doesn\'t watch.', 'cold relief'),
            ],
          },
          {
            number: 2,
            title: 'Denouement / New Normal',
            scenes: [
              scene(15, 'Aftermath', 'Empty precinct', 'Dawn', 'She sets the dossier on the captain\'s desk and turns to leave.', 'No one stops her. The door closes behind her.', 'bittersweet'),
              scene(16, 'Horizon', 'City rooftop — same as Act 1', 'Sunrise', 'Same shot as the opening, but she\'s facing the other direction now.', 'She breathes. Faint hint of a smile.', 'earned hope'),
            ],
          },
        ],
      },
    ],
    storyBeats: {
      openingImage: 'Detective alone on a rooftop at dawn, watching a city that doesn\'t know she exists.',
      statusQuo: null,
      incitingIncident: null,
      lockIn: null,
      midpoint: null,
      crisis: null,
      climax: null,
      resolution: null,
    },
  };

  return {
    id,
    userId,
    name: name || '🎬 Demo Story',
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: 'assistant',
        content: "This is a demo project pre-loaded with sample shots so you can explore the UI without an API key. Try clicking a shot card, dragging scenes, or using the chat panel when you're ready!",
        timestamp: now,
      },
    ],
    storyboard,
    entities: {
      characters: [
        {
          id: 'detective_reyes',
          name: 'Detective Reyes',
          description: 'A sharp, closed-off detective pulled back in from retirement.',
          visualPromptDescription: 'Late-30s Latina woman, short dark hair, leather jacket, intense eyes.',
          role: 'Protagonist',
          firstAppearance: '1.1.1',
          color: '#10a37f',
        },
        {
          id: 'the_contact',
          name: 'The Contact',
          description: 'Enigmatic informant — enemy or ally, never clear.',
          visualPromptDescription: 'Mid-40s man, expensive overcoat, always too calm.',
          role: 'Antagonist',
          firstAppearance: '1.1.2',
          color: '#7c8cff',
        },
      ],
      locations: [
        {
          id: 'city_rooftop',
          name: 'City Rooftop',
          description: 'The recurring visual anchor — dawn in Act 1, sunrise in Act 3.',
          visualPromptDescription: 'Urban rooftop, ventilation ducts, city skyline behind.',
          mood: 'Isolation, perspective',
        },
        {
          id: 'container_port',
          name: 'Container Port',
          description: 'The climax location — labyrinthine, industrial, dangerous.',
          visualPromptDescription: 'Night-time shipping port, stacked steel containers, single floodlight.',
          mood: 'Menacing, industrial',
        },
      ],
    },
  };
}


export function createCharacter(name, opts = {}) {
  const now = new Date().toISOString();
  const safeName = String(name || '').trim();
  const baseId = safeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return {
    id: baseId || `character_${Date.now()}`,
    userId: String(opts.userId || 'local_user'),
    name: safeName,
    description: String(opts.description || '').trim(),
    visualPromptDescription: String(opts.visualPromptDescription || opts.description || '').trim(),
    role: String(opts.role || 'Supporting').trim(),
    firstAppearance: String(opts.firstAppearance || '').trim(),
    color: String(opts.color || '').trim(),
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    createdAt: now,
    updatedAt: now,
    sourceStoryId: String(opts.sourceStoryId || '').trim(),
  };
}

export function createLocation(name, opts = {}) {
  const now = new Date().toISOString();
  const safeName = String(name || '').trim();
  const baseId = safeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return {
    id: baseId || `location_${Date.now()}`,
    userId: String(opts.userId || 'local_user'),
    name: safeName,
    description: String(opts.description || '').trim(),
    visualPromptDescription: String(opts.visualPromptDescription || opts.description || '').trim(),
    mood: String(opts.mood || '').trim(),
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    createdAt: now,
    updatedAt: now,
    sourceStoryId: String(opts.sourceStoryId || '').trim(),
  };
}
