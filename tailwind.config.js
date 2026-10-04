const styles = require('./src/modules/game-engine/drawing/styles');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Replaces Tailwind's stacks rather than extending them, so `font-sans` means the game's font
    // instead of the framework's default — index.css applies these rather than repeating them.
    // destiny.gg's pair: Inter for everything read, Poppins for headings and the logo. Both are
    // bundled (main.tsx), so nothing is fetched from a font service.
    fontFamily: {
      sans: ['Inter Variable', 'system-ui', 'sans-serif'],
      display: ['Poppins', 'Inter Variable', 'system-ui', 'sans-serif'],
      mono: ['source-code-pro', 'Menlo', 'Monaco', 'Consolas', 'Courier New', 'monospace'],
    },
    fontSize: {
      xs: '0.75rem',
      sm: '1rem',
      md: '1.25rem',
      lg: '1.5rem',
      xl: '2rem',
      '2xl': '2.5rem',
      '3xl': '3rem',
      '4xl': '3.5rem',
      '5xl': '4rem',
      '6xl': '10rem',
    },
    extend: {
      /**
       * Keeping text readable on top of the song video, which is the app's default background and
       * can be any frame of anything. This is the treatment to reach for — not a plate behind the
       * text, which hides the video the screen exists to show.
       *
       * Two sizes because the halo has to scale with the text: the default suits body and heading
       * sizes, `lg` is for the large prompts that sit over full-screen video.
       */
      textShadow: {
        legible: '0px 0px 3px #000000',
        'legible-lg': '0 0 2rem black',
      },
      /**
       * The stacking ladder. Every layer that escapes its parent — anything `fixed` or portalled —
       * takes a rung here instead of picking a number, which is how the app ended up with values
       * from 0 to 100000 that only made sense pairwise.
       *
       * Plain `z-1`, `z-2`, `z-10` stay right for stacking *inside* a component: those form their
       * own context and never compete with these.
       */
      zIndex: {
        scene: '0', // the song's background image, behind everything
        'scene-hint': '4', // skip intro/outro prompts
        'scene-overlay': '10', // the blurred song backdrop while singing
        'scene-cover': '20', // the still that covers the game overlay until video starts
        hud: '30', // in-game readouts: live leaderboard, status text
        'hud-blocking': '40', // takes the screen: countdown, readiness, the mobile action bar
        chrome: '50', // sticky headers and bars belonging to a screen
        'expanded-backdrop': '60', // the expanded song preview and its scrim
        expanded: '61',
        help: '70', // the keyboard help panel
        toolbar: '80', // the dev toolbar
        'modal-backdrop': '90', // dialogs, over everything a screen owns
        modal: '91',
        'modal-top-backdrop': '92', // a dialog or sheet opened from inside another
        'modal-top': '93',
        toast: '100', // connection status — must outrank even a modal
      },
      boxShadow: {
        focusable: 'inset 0 0 0 1px rgba(0,144,255,.3), inset 0px 0px 40px 2px rgba(0,0,0,0.2)',
      },
      colors: {
        /**
         * destiny.gg's neutrals: the near-black page, the opaque surface a dialog is built from, and
         * the edge drawn around it. In-game surfaces stay translucent black over the video instead.
         */
        canvas: '#111113',
        surface: '#18191b',
        line: '#43484e',
        default: styles.colors.text.default,
        inactive: styles.colors.text.inactive,
        text: {
          'player-0': styles.colors.players[0].text,
          'player-0-christmas': styles.colorSets.christmasGreen.text,
          'player-1': styles.colors.players[1].text,
          'player-1-christmas': styles.colorSets.christmasRed.text,
        },
        /**
         * Status. Four roles, each one value used as text, icon fill, border and background — so
         * they are colours rather than a composed class string.
         *
         * None of them may look like `active`, which means *focused*: across a room, an unstable-mic
         * icon must not read as a focused control. `active` is destiny.gg's blue, so `info` is violet
         * rather than the blue it was upstream.
         *
         * These are the `-400` steps of Tailwind's own ramps, which is where the contrast sits on
         * both grounds the app uses — the dialog slate and the near-black in-game card. The `error`
         * token this replaces was pure `red`, which misses AA against the dialog surface.
         */
        danger: 'oklch(70.4% 0.191 22.216)', // red-400
        warning: 'oklch(82.8% 0.189 84.429)', // amber-400
        success: 'oklch(79.2% 0.209 151.711)', // green-400
        info: 'oklch(70.2% 0.183 293.541)', // violet-400
        active: styles.colors.text.active,
      },
      keyframes: {
        gradient: {
          '0%': {
            backgroundPosition: '0% 50%',
          },
          '100%': {
            backgroundPosition: '0% 50%',
          },
        },
        focused: {
          '0%, 100%': {
            'box-shadow': `inset 0px 0px 0px 3px ${styles.colors.text.active}`,
          },
          '50%': {
            'box-shadow': `inset 0px 0px 0px 3px ${styles.colors.text.active}`,
          },
        },
        buttonFocused: {
          '0%, 100%': {
            transform: 'scale(1.020)',
          },
          '50%': {
            transform: 'scale(1.030)',
          },
        },
        calibrationPulse: {
          '0%': {
            transform: 'scale(1)',
          },
          '50%, 100%': {
            transform: 'scale(0)',
          },
        },
        blink: {
          '100%': {
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
          },
          '30%': {
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
          },
          '50%': {
            backgroundColor: 'rgba(200, 200, 200, 0.85)',
          },
          '0%': {
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
          },
        },
        'lyrics-pop': {
          '0%, 100%': {
            transform: 'scale(1)',
          },
          '10%': {
            transform: 'scale(1.15)',
          },
        },
        'lyrics-shake': {
          '10%, 90%': {
            transform: 'translate3d(-0.1rem, 0, 0)',
          },
          '20%, 80%': {
            transform: 'translate3d(0.2rem, 0, 0)',
          },
          '30%, 50%, 70%': {
            transform: 'translate3d(-0.4rem, 0, 0)',
          },
          '40%, 60%': {
            transform: 'translate3d(0.4rem, 0, 0)',
          },
        },
      },
      animation: {
        blink: 'blink 1050ms ease-in-out infinite both',
        'calibrate-pulse': 'calibrationPulse 1.5s ease 1',
        gradient: 'gradient 15s ease infinite',
        focused: 'focused 1000ms ease-in-out infinite both',
        'button-focused': 'buttonFocused 600ms ease-in-out infinite both',
        'lyrics-pop': 'lyrics-pop 500ms ease-in-out 0s 1 both',
        'lyrics-shake': 'lyrics-shake 0.92s cubic-bezier(0.36, 0.07, 0.19, 0.97) 0s infinite both',
      },
    },
  },
  plugins: [],
};
