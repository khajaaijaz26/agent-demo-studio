# Image asset provenance and prompt record

Provider: OpenAI built-in image generation (`imagegen`). The campaign did not use downloaded stock media, real pupils, identity cloning, copyrighted characters, logos, or third-party image-generation fallbacks.

## Shared prompt foundation

The following foundation was applied to the cast anchor and each final scene plate:

> Create an original polished 3D children's educational animation image for a vertical classroom story. Use rounded shapes, tactile clay-like materials, expressive but natural faces, warm cinematic morning light, rich navy, sky blue, sunny yellow, coral, leaf green, and warm cream. This must not imitate any named studio, franchise, artist, or copyrighted character. Show exactly five fictional people and no additional people: Ms. Maya, a South Asian teacher in her early thirties with warm brown skin, shoulder-length dark wavy hair, a mustard cardigan over a teal blouse, navy trousers, brown flats, and small round gold earrings; Leo, a Black ten-year-old boy with short coiled hair and a cobalt-blue hoodie; Amina, an Arab ten-year-old girl with a long dark braid, coral headband, cream top, and green overalls; Mei, an East Asian nine-year-old girl with a chin-length black bob, round glasses, and a lavender sweatshirt; and Sam, a white eleven-year-old boy with freckles, tousled auburn hair, a yellow T-shirt, and denim overalls. Keep every face, hairstyle, skin tone, outfit, age, and body proportion consistent. Compose natively at 9:16 for a phone screen. Keep characters large and clearly separated, with clean hands and eyes, coherent furniture, readable educational action, clear space for deterministic top titles and lower captions, and no in-image words, letters, logos, signatures, or watermarks.

The cast anchor was used as the identity and style reference for every scene. From scene 2 onward, the cast anchor and preceding scene were supplied as references to preserve continuity.

## Final scene prompt blocks

Each block below was appended to the shared foundation for the corresponding generated file.

### `assets/generated/character-anchor.png`

> Create a clean full-cast character anchor in the same warm modern elementary classroom. Arrange Ms. Maya standing behind the four students so all five faces, complete outfit colors, and defining features are unobstructed. Give the group friendly, attentive expressions and neutral educational poses. Prioritize identity clarity and continuity over action.

### `assets/generated/scenes/01-welcome.png`

> Opening classroom scene. Ms. Maya stands near a large blank interactive board, warmly waves to welcome the class, and looks toward the children. The four students sit around curved classroom tables, turning toward her and listening. Show exactly Ms. Maya, Leo, Amina, Mei, and Sam. Use an inviting wide portrait composition with a strong central teacher silhouette, large faces, warm sunlight, and uncluttered space at the upper center for the opening title.

### `assets/generated/scenes/02-big-question.png`

> Question scene. Ms. Maya points toward a simple visual display of a bright sun above an ocean, a lake, and a small puddle. Leo, Amina, Mei, and Sam face the board and lean forward with curiosity. Show exactly the same five characters in the same outfits and classroom. Keep the science pictures large, visually obvious, and free of text; leave upper-center title space.

### `assets/generated/scenes/03-evaporation.png`

> Evaporation demonstration. Ms. Maya safely demonstrates a shallow bowl of water under a warm classroom lamp while soft white vapor trails and upward arrows rise toward a cloud diagram on the interactive board. All four students watch the rising vapor with focused, delighted expressions. Preserve the exact five-character cast and outfits. Make the upward movement immediately understandable without any written labels.

### `assets/generated/scenes/04-condensation.png`

> Condensation lesson. Ms. Maya gestures across a large visual sequence on the board where tiny water droplets gather into one fluffy cloud. Leo, Amina, Mei, and Sam sit close together, clearly listening and tracking the droplets. Preserve the exact cast, outfits, classroom, warm lighting, and 9:16 composition. The cloud and droplets must be large enough for a phone screen and contain no text.

### `assets/generated/scenes/05-precipitation.png`

> Precipitation lesson. The board shows a friendly cloud releasing clearly different rain, snow, and small hail shapes. Amina raises one hand confidently; Ms. Maya acknowledges her while Leo, Mei, and Sam stay focused on the lesson. Preserve the exact five characters and outfits. Use clear body language, large science visuals, safe title and caption space, and no written text.

### `assets/generated/scenes/06-complete-cycle.png`

> Warm finale. Ms. Maya and the four students gather closely around a large circular tabletop water-cycle model containing ocean, rising vapor, one cloud, falling rain, green hills, a river, and collection arrows. Amina raises a finger, Ms. Maya gives a thumbs-up, and all five characters smile with genuine learning excitement. Preserve the exact cast and clothing. Make the complete circular journey obvious, centered, clean, and large on a phone screen, with a calm blue board behind them for the final water-drop graphic.

## Continuity and rights notes

- All people are fictional; no real child or teacher was used as a reference.
- The generated plates contain no relied-upon text. Titles, diagrams, motion accents, and captions are composited by the deterministic renderer.
- The final six scene files and cast anchor are retained in the repository so a rebuild does not silently replace approved artwork.
- Publication should follow each destination platform's current synthetic-media disclosure rules.
