# Chooms!'s knowledge cards

What each person knows and feels at each point of the story, so their posts (and later their DMs) never run ahead of the player's save. Made once, ahead of time, shipped in the package: every player gets the same cards, and each save's journal picks which apply (docs/design.md, "C2 plan").

One file per person, named by their id in `../roster.json`: `judy.md`, `panam.md` and so on.

```markdown
# Judy Alvarez

## start
Knows: ...
Feels: ...
Posts: ...

## judy-bd
Knows: ...
```

| Part | What |
|---|---|
| `## start` | Who they are before the story touches them: their life, their work, what they think of the city. True from the first save on |
| `## <point>` | A story point's id from `../story.json`. The card applies once V has passed that point |
| `Knows:` | What they know by then, about V and about what happened |
| `Feels:` | How they feel about it, and about V |
| `Posts:` | What they might post about now |

A prompt carries a person's `start` card and the cards of every point V has passed, in the story's order. A person who has died posts nothing, so their cards stop there.

## How they are written

- **Our own words.** No dialogue or journal text from the game.
- **V without pronouns.** V's body and pronouns differ between saves: always "V".
- **Only what they would know.** A card says what this person knows at that point, not what V or the player knows. Nothing from later points.
- **Neutral where the story branches.** Where an outcome depends on the player's choices (a romance, who lives, how a deal ends), the card says what is true in every outcome and leaves the rest out.
- **Short.** Each line one or two sentences.

`node tests/all.mjs --offline` checks that every heading is `start` or a story point, and every file a person in the roster.
