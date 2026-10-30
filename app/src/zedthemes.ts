// Zed's built-in themes One (from Atom), Ayu and Gruvbox: their own theme files (github.com/zed-industries/zed,
// assets/themes; MIT, see THIRD-PARTY-NOTICES.md), cut to the dark and light variant and the keys themes.ts reads.
export const ZED_BUILTIN: Record<string, any> = {
 "one": {
  "name": "One",
  "author": "Zed Industries",
  "themes": [
   {
    "name": "One Dark",
    "appearance": "dark",
    "style": {
     "background": "#3b414dff",
     "editor.background": "#282c33ff",
     "editor.foreground": "#acb2beff",
     "surface.background": "#2f343eff",
     "panel.background": "#2f343eff",
     "border": "#464b57ff",
     "text": "#dce0e5ff",
     "text.muted": "#a9afbcff",
     "text.accent": "#74ade8ff",
     "created": "#a1c181ff",
     "deleted": "#d07277ff",
     "modified": "#dec184ff",
     "warning": "#dec184ff",
     "search.match_background": "#74ade866",
     "search.active_match_background": "#e8af7466",
     "players": [
      {
       "cursor": "#74ade8ff"
      },
      {
       "cursor": "#be5046ff"
      },
      {
       "cursor": "#bf956aff"
      }
     ],
     "syntax": {
      "keyword": {
       "color": "#b477cfff"
      },
      "function": {
       "color": "#73ade9ff"
      },
      "number": {
       "color": "#bf956aff"
      },
      "constant": {
       "color": "#dfc184ff"
      },
      "string": {
       "color": "#a1c181ff"
      },
      "type": {
       "color": "#6eb4bfff"
      },
      "comment": {
       "color": "#5d636fff"
      },
      "tag": {
       "color": "#74ade8ff"
      },
      "attribute": {
       "color": "#74ade8ff"
      },
      "property": {
       "color": "#d07277ff"
      },
      "variable.parameter": {
       "color": "#d07277ff"
      },
      "variable.special": {
       "color": "#bf956aff"
      }
     }
    }
   },
   {
    "name": "One Light",
    "appearance": "light",
    "style": {
     "background": "#dcdcddff",
     "editor.background": "#fafafaff",
     "editor.foreground": "#242529ff",
     "surface.background": "#ebebecff",
     "panel.background": "#ebebecff",
     "border": "#c9c9caff",
     "text": "#242529ff",
     "text.muted": "#58585aff",
     "text.accent": "#5c78e2ff",
     "created": "#669f59ff",
     "deleted": "#d36151ff",
     "modified": "#a48819ff",
     "warning": "#a48819ff",
     "search.match_background": "#5c79e266",
     "search.active_match_background": "#d0a92366",
     "players": [
      {
       "cursor": "#5c78e2ff"
      },
      {
       "cursor": "#984ea5ff"
      },
      {
       "cursor": "#ad6e26ff"
      }
     ],
     "syntax": {
      "keyword": {
       "color": "#a449abff"
      },
      "function": {
       "color": "#5b79e3ff"
      },
      "number": {
       "color": "#ad6e25ff"
      },
      "constant": {
       "color": "#c18401ff"
      },
      "string": {
       "color": "#649f57ff"
      },
      "type": {
       "color": "#3882b7ff"
      },
      "comment": {
       "color": "#a2a3a7ff"
      },
      "tag": {
       "color": "#5c78e2ff"
      },
      "attribute": {
       "color": "#5c78e2ff"
      },
      "property": {
       "color": "#d3604fff"
      },
      "variable.parameter": {
       "color": "#d3604fff"
      },
      "variable.special": {
       "color": "#ad6e25ff"
      }
     }
    }
   }
  ]
 },
 "ayu": {
  "name": "Ayu",
  "author": "Zed Industries",
  "themes": [
   {
    "name": "Ayu Dark",
    "appearance": "dark",
    "style": {
     "background": "#313337ff",
     "editor.background": "#0d1016ff",
     "editor.foreground": "#bfbdb6ff",
     "surface.background": "#1f2127ff",
     "panel.background": "#1f2127ff",
     "border": "#3f4043ff",
     "text": "#bfbdb6ff",
     "text.muted": "#8a8986ff",
     "text.accent": "#5ac1feff",
     "created": "#aad84cff",
     "deleted": "#ef7177ff",
     "modified": "#feb454ff",
     "warning": "#feb454ff",
     "search.match_background": "#5ac2fe66",
     "search.active_match_background": "#ea570166",
     "players": [
      {
       "cursor": "#5ac1feff"
      },
      {
       "cursor": "#39bae5ff"
      },
      {
       "cursor": "#fe8f40ff"
      }
     ],
     "syntax": {
      "keyword": {
       "color": "#ff8f3fff"
      },
      "function": {
       "color": "#ffb353ff"
      },
      "number": {
       "color": "#d2a6ffff"
      },
      "constant": {
       "color": "#d2a6ffff"
      },
      "string": {
       "color": "#a9d94bff"
      },
      "type": {
       "color": "#59c2ffff"
      },
      "comment": {
       "color": "#5c6773ff"
      },
      "tag": {
       "color": "#5ac1feff"
      },
      "attribute": {
       "color": "#5ac1feff"
      },
      "property": {
       "color": "#5ac1feff"
      },
      "variable.parameter": {
       "color": "#d2a6ffff"
      }
     }
    }
   },
   {
    "name": "Ayu Light",
    "appearance": "light",
    "style": {
     "background": "#dcdddeff",
     "editor.background": "#fcfcfcff",
     "editor.foreground": "#5c6166ff",
     "surface.background": "#ececedff",
     "panel.background": "#ececedff",
     "border": "#cfd1d2ff",
     "text": "#5c6166ff",
     "text.muted": "#8b8e92ff",
     "text.accent": "#3b9ee5ff",
     "created": "#85b304ff",
     "deleted": "#ef7271ff",
     "modified": "#f1ad49ff",
     "warning": "#f1ad49ff",
     "search.match_background": "#3b9ee566",
     "search.active_match_background": "#f88b3666",
     "players": [
      {
       "cursor": "#3b9ee5ff"
      },
      {
       "cursor": "#55b4d3ff"
      },
      {
       "cursor": "#f98d3fff"
      }
     ],
     "syntax": {
      "keyword": {
       "color": "#fa8d3eff"
      },
      "function": {
       "color": "#f2ad48ff"
      },
      "number": {
       "color": "#a37accff"
      },
      "constant": {
       "color": "#a37accff"
      },
      "string": {
       "color": "#86b300ff"
      },
      "type": {
       "color": "#389ee6ff"
      },
      "comment": {
       "color": "#abb0b6ff"
      },
      "tag": {
       "color": "#3b9ee5ff"
      },
      "attribute": {
       "color": "#3b9ee5ff"
      },
      "property": {
       "color": "#3b9ee5ff"
      },
      "variable.parameter": {
       "color": "#a37accff"
      }
     }
    }
   }
  ]
 },
 "gruvbox": {
  "name": "Gruvbox",
  "author": "Zed Industries",
  "themes": [
   {
    "name": "Gruvbox Dark",
    "appearance": "dark",
    "style": {
     "background": "#4c4642ff",
     "editor.background": "#282828ff",
     "editor.foreground": "#ebdbb2ff",
     "surface.background": "#3a3735ff",
     "panel.background": "#3a3735ff",
     "border": "#5b534dff",
     "text": "#fbf1c7ff",
     "text.muted": "#c5b597ff",
     "text.accent": "#83a598ff",
     "created": "#b7bb26ff",
     "deleted": "#fb4a35ff",
     "modified": "#f9bd2fff",
     "warning": "#f9bd2fff",
     "search.match_background": "#83a59866",
     "search.active_match_background": "#c09f3f66",
     "players": [
      {
       "cursor": "#83a598ff"
      },
      {
       "cursor": "#a89984ff"
      },
      {
       "cursor": "#fd801bff"
      }
     ],
     "syntax": {
      "keyword": {
       "color": "#fb4833ff"
      },
      "function": {
       "color": "#b8bb25ff"
      },
      "number": {
       "color": "#d3869bff"
      },
      "constant": {
       "color": "#fabd2eff"
      },
      "string": {
       "color": "#b8bb25ff"
      },
      "type": {
       "color": "#fabd2eff"
      },
      "comment": {
       "color": "#a89984ff"
      },
      "tag": {
       "color": "#8ec07cff"
      },
      "attribute": {
       "color": "#83a598ff"
      },
      "property": {
       "color": "#ebdbb2ff"
      },
      "variable.parameter": {
       "color": "#ebdbb2ff"
      },
      "variable.special": {
       "color": "#83a598ff"
      }
     }
    }
   },
   {
    "name": "Gruvbox Light",
    "appearance": "light",
    "style": {
     "background": "#d9c8a4ff",
     "editor.background": "#fbf1c7ff",
     "editor.foreground": "#282828ff",
     "surface.background": "#ecddb4ff",
     "panel.background": "#ecddb4ff",
     "border": "#c8b899ff",
     "text": "#282828ff",
     "text.muted": "#5f5650ff",
     "text.accent": "#0b6678ff",
     "created": "#797410ff",
     "deleted": "#9d0308ff",
     "modified": "#b57615ff",
     "warning": "#b57615ff",
     "search.match_background": "#0b667866",
     "search.active_match_background": "#ba2d1166",
     "players": [
      {
       "cursor": "#0b6678ff"
      },
      {
       "cursor": "#7c6f64ff"
      },
      {
       "cursor": "#af3a04ff"
      }
     ],
     "syntax": {
      "keyword": {
       "color": "#9d0006ff"
      },
      "function": {
       "color": "#79740eff"
      },
      "number": {
       "color": "#8f3e71ff"
      },
      "constant": {
       "color": "#b57613ff"
      },
      "string": {
       "color": "#79740eff"
      },
      "type": {
       "color": "#b57613ff"
      },
      "comment": {
       "color": "#7c6f64ff"
      },
      "tag": {
       "color": "#427b58ff"
      },
      "attribute": {
       "color": "#0b6678ff"
      },
      "property": {
       "color": "#282828ff"
      },
      "variable.parameter": {
       "color": "#282828ff"
      },
      "variable.special": {
       "color": "#066578ff"
      }
     }
    }
   }
  ]
 }
};
