# Nothing AI

**Speak freely. Think clearly. Keep everything.**

A quiet voice notebook. It's an installable web app (PWA) that looks like a typewriter page on pale celadon (sage-green) paper, with dot-matrix details and one signal-red accent. There are no rounded corners anywhere.

## What it does

- **Structured dictation.** Live speech-to-text with a symbol dock: `.` `,` `?` `!` `↵` `¶` `1.` `•` `☐` `H` `“` `⌫`. If you tap a symbol mid-sentence, it lands right after the words heard so far. Tap `1.` to start a numbered list and the chip turns into `2.` for the next item. You can also say “next” or “number two”.
- **Spoken commands.** Say “comma”, “full stop”, “question mark”, “new line”, “new paragraph”, “numbered list”, “bullet point”, “checkbox”, “next point”, “new heading” or “end list”.
- **Dot-matrix waveform** that reacts to your microphone, plus a staged processing sequence (Listening → Transcribing → Understanding → Organizing → Ready).
- **Typewriter editor.** Lists continue when you press Enter. Markdown shortcuts work (`1. ` `- ` `[] ` `# ` `> `). Checkboxes animate when you tick them.
- **AI tools (Gemini free tier):** clean up the transcript, summarize, convert into a checklist, rewrite in a different tone, extract action items, and generate a title and tags. AI-written text is marked with ✦. **The original transcript (and audio) is always recoverable**, and every replacement saves a version you can restore.
- **Ask My Notes.** Semantic search across everything you've recorded. Answers cite the notes they came from.
- **Read aloud** with three engines:
  - *Device*: built-in voices, instant and offline.
  - *Neural*: Kokoro, which runs in the browser. It's free and private, with a ~90 MB one-time download.
  - *Gemini*: studio voices with a “soothing” delivery prompt.

  You can adjust voice, speed, pitch, the pause between sentences, and “warmth” (a soft low-pass filter).
- **Library.** Search by words or by meaning, and filter by tag or date. Pinned and archived notes have their own views.
- Everything is stored **on your device** (IndexedDB). You can export or import a JSON backup. There's also an Ink (dark) theme and a reduced-motion option.

## Setup

1. Open the site in **Chrome or Edge** (Android or desktop). Safari works too. Live dictation needs the Web Speech API.
2. Get a free API key at https://aistudio.google.com/apikey and paste it into **Settings → Intelligence → Test**. The app finds the newest free Flash model on its own and moves to the next one if a model hits its quota.
3. Optional: under **Settings → Read aloud → Neural**, download the soft neural voice.

Keyboard (desktop): `R` record · `N` notes · `A` ask · `/` search · `,` settings. While recording: `space` pauses or resumes, `. , ? !` add punctuation, `Enter` starts a new line or item, `1` `-` `[` `H` `Q` set the structure, and `Backspace` undoes.

## Stack

Plain HTML, CSS and ES modules. There's no build step, so it deploys as-is to GitHub Pages.
`js/speech.js` (dictation model) · `js/editor.js` (block editor) · `js/ai.js` (Gemini) · `js/tts.js` + `js/kokoro-worker.js` (read aloud) · `js/wave.js` (waveform) · `js/main.js` (screens).

Built by K S Pankaj.
