<!-- 来源：https://raw.githubusercontent.com/cheng1559/novelai-agent/7a069039978fe0ca08042885c8b251455900478b/skills/novelai-v5-prompt/references/prompt-syntax.md；由 scripts/sync-skill.mjs 同步，请勿手工修改。 -->

# NovelAI V5 Prompt Syntax

This reference collects the prompt syntax most useful when writing NovelAI Diffusion V5 prompts. V5 documentation was still catching up to the V5 release, so combine the long-standing NovelAI syntax below with the V5-specific notes in `SKILL.md`.

## Tag versus natural language

Tag form:

```text
1girl, solo, silver hair, blue eyes, school uniform, city street, night, rain, neon lights, high complexity, very aesthetic, best quality
```

Natural-language form:

```text
A silver-haired girl in a school uniform stands alone on a rain-soaked neon city street at night, illuminated by glowing signs.
```

Both work in V5. Tag form is more deterministic for small attributes; prose is better for scene relationships, dialogue, and comic instructions.

## Ordering and priority

Recommended ordering for common tags:

```text
1boy, 1girl, characters, series, everything else in any order
```

For V3 and older models, earlier tags were stronger. In V4+ models, order matters less, but keeping the main subject near the front is still a useful habit.

## Quality and aesthetic tags

Quality tags:

```text
best quality
amazing quality
great quality
normal quality
bad quality
worst quality
```

Aesthetic tags:

```text
very aesthetic
aesthetic
displeasing
very displeasing
```

`masterpiece` and `top aesthetic` are documented for specific older models. Community V5 prompts still include `masterpiece`, but treat it as a soft style/quality cue rather than a required tag.

Complexity tags (V5):

```text
low complexity
high complexity
ultra complexity
```

Use `high complexity` by default.

Dataset tags, when relevant:

```text
fur dataset
background dataset
```

Place dataset tags at the very start of the base prompt.

## Strengthening and weakening

Bracket emphasis:

```text
1girl, black hair, {{{chibi}}}, catgirl under a cherry blossom tree
```

- `{...}` multiplies emphasis by 1.05 per pair.
- `[...]` divides emphasis by 1.05 per pair.
- Nested brackets compound the effect.

Numeric emphasis:

```text
1girl, 1.5::rain, night ::, 0.5::coat ::, black shoes
```

Use a number immediately before `::` to start emphasis, and a bare `::` to end it. Numbers above 1 strengthen; numbers between 0 and 1 weaken. This is available on V4 and higher.

Negative numeric emphasis:

```text
-1::hat::
-3::hat::
-1::monochrome::
```

Use negative values for targeted removal or to invert a concept. This is available on V4.5 and higher, and likely applies to V5.

## Undesired Content

Common safe defaults:

```text
nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, jpeg artifacts, very displeasing, multiple views, logo, too many watermarks, rating:sensitive, variant set, twitter username
```

Add specific negatives when needed, such as `bad hands`, `extra fingers`, `text`, or a particular unwanted pose/object.

## Multi-character prompting

Preferred form is separate character boxes:

Base prompt:

```text
2girls, indoors, classroom, afternoon, warm light
```

Character 1:

```text
girl, black hair, short hair, blue eyes, sailor uniform
```

Character 2:

```text
girl, blonde hair, long hair, green eyes, cardigan
```

Do not include a number in the character prompts themselves. The subject count goes in the base prompt.

The older `|` separator syntax is available for V4 and is disabled when character boxes exist:

```text
2girls, indoors, classroom, afternoon, warm light | girl, black hair, short hair, blue eyes | girl, blonde hair, long hair, green eyes
```

Interaction action tags:

```text
source#hug
target#hug
mutual#hug
```

## Text rendering

Example:

```text
1girl, text, english text, location, park, cowboy shot, looking at viewer
The girl is saying "Hello!" in yellow text.
Text: Hello!
```

Keep `Text:` at the very end of the prompt. For multiple text pieces, use Shift+Enter and put an empty line between them:

```text
Text: Hello!

Text: Wait, what?
```

Keep individual texts under about 120 characters. If short text does not appear, disable Add Quality Tags and try again.

## Prompt Chunks

For reusable style/character/quality blocks, save them as Prompt Chunks from the gear/sidebar settings rather than retyping them. This is useful for consistent characters and style presets.
