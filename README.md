🎸 Chord Finder

A website that listens to a song and shows which guitar chords are playing, and when. Upload an MP3 or WAV file, press play, and the chords light up in time with the music. It also suggests a capo position to make the chords easier to play.

Live demo: https://krish09jc2008.github.io/CHORDS-PROJECT/

# Why I made this

I play guitar, and finding the chords of a new song is always the hardest part. This project finds them automatically from the audio itself.

# Features

- Upload an MP3 or WAV file and get the chords of the song
- Chord timeline: tap any chord to jump to that moment in the song
- A big chord display that follows the music while it plays
- Lists the main chords used in the song
- Capo suggestion (which fret, and which easy shapes to play)
- Runs fully in the browser: no server, no sign-up, and your song never leaves your device

# How it works

The chords are found directly from the sound. The project does not look anything up online and does not use a chord database.

1. **Read the audio** using the browser's Web Audio API.
2. **FFT (Fast Fourier Transform)** turns each short slice of sound into the strength of every pitch.
3. **12-note fingerprint:** all pitches are folded into the 12 notes (C, C#, D ... B). Low bass notes get extra weight, because the bass usually plays the root of the chord.
4. **Template matching:** each fingerprint is compared with 24 chord shapes (12 major and 12 minor), and the closest match wins.
5. **Smart cleanup:** the song's most-used chords get a small boost, neighbouring moments vote on the final chord, and chords shorter than 1.5 seconds are merged. This removes flickering.
6. **Capo suggestion:** frets 0 to 7 are tried, and the one that gives the most easy open-chord shapes is chosen.

# Technologies

HTML, CSS and JavaScript only. No libraries and no backend.

# Project files

| File | What it does |
|---|---|
| `index.html` | Page structure |
| `style.css` | Design (gradients and glow effects) |
| `script.js` | Audio analysis, chord detection and capo logic |

# How to run it

1. Download or clone this repository.
2. Open `index.html` in Chrome.
3. Choose a song file and press play.

# Results and limits

- On a test song, it found the same five chords that a popular chord website lists for it (B♭, Gm, E♭, Dm, F).
- It detects **major and minor chords only**. Chords like 7th or sus are matched to the nearest simple chord.
- Accuracy is best for songs with a clear guitar or piano. Loud drums or heavy vocals can reduce it.
- It does not take YouTube links, because a browser-only page cannot download audio from YouTube.
- The capo is a suggestion for easier shapes. Audio alone cannot tell if the original musician used a capo.

# Future ideas

- Tempo (BPM) detection
- 7th and sus chords
- Chord diagrams showing finger positions
- A transpose button

## Author

Mankrish Pal Singh, 
