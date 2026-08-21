// Where the API lives.
//
// Empty means same origin, which is how it runs on Railway (one server for both
// the site and the API) and locally. The Vercel build overwrites this file with
// the Railway URL, because a static front end on one host cannot reach an API on
// another with relative paths.
window.GROKLOOP_API = '';
