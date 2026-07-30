const PREFIX = "/StarshipArchitect";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX || url.pathname === PREFIX + "/") {
      url.pathname = "/index.html";
    } else if (url.pathname.startsWith(PREFIX + "/")) {
      url.pathname = url.pathname.slice(PREFIX.length);
    }
    return env.ASSETS.fetch(new Request(url, request));
  }
};
