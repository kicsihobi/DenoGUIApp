import { parseArgs } from "jsr:@std/cli/parse-args";

import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";

import { STATIC_ASSETS } from "./src/static_assets.ts";





const cmdArgs = parseArgs( Deno.args, {
  boolean  : [ 'help', 'verbose' ],
  string   : [ 'port', 'host', 'cert', 'key', 'browser' ],
  alias    : { help: 'h', verbose: 'v', port: 'p', host: 'H', cert: 'c', key: 'k' },
  default  : {
    host: 'localhost',
    port: '8000',
    browser: true
  },
  negatable : [ 'browser' ],
  unknown   : ( arg, key, value ) => console.warn( `[W] Unknown argument: ${ ( key !== undefined ) ? key + '=' + value : arg }` )
} );





const engine = Deno.execPath( ).split( '/' ).pop( );
const executable = ( engine === 'deno' ) ? 'deno run ' + import.meta.url.split( '/' ).pop( ) : engine;
const helpMessage = `Usage: ${executable} [options]
  
Options:
  --port, -p      Port to listen on. Default: 8000
  --cert, -c      SSL certificate. If set HTTPS will be used, and --key also needs to set
  --key, -k       SSL private key file for the certificate. If set HTTPS will be used, and --cert also needs to set
  --browser, -b   Either a flag to guess (default), or a path to the executable to the browser to load the client with
  --no-browser    Same as --browser=false
  --host, -H      Hostname/address to open up with the browser. Default: localhost
  --verbose, -v   Enable verbose debug output
  --help, -h      Show this help message
`;

if( cmdArgs.help === true ) {
  console.log( helpMessage );
  Deno.exit( );
}





const port = parseInt( cmdArgs.port );
if ( isNaN( port ) || port <= 0 || port > 65534 ) { /** @todo: more precise limits here */
  console.error( `[E] Invalid port "${cmdArgs.port}. Exiting ...` );
  Deno.exit( -1 );
}

let serverOptions = { port: port };
let proto = "http";

async function fileExists( path: string ) : boolean {
  try {
    const stats = await Deno.lstat( path );
  } catch ( err ) {
    //Debug log the err
    return false;
  }
  return true;
}

if ( typeof cmdArgs.cert === "string" || typeof cmdArgs.key === "string"  ) {
  const isCertFile = await fileExists( cmdArgs.cert );
  const isKeyFile  = await fileExists( cmdArgs.key );
  if ( !isCertFile ) {
    console.error( `[E] Could not open '${cmdArgs.cert}'. Exiting ...` );
    Deno.exit( -2 );
  }
  serverOptions.cert = Deno.readTextFileSync(cmdArgs.cert);
  if ( !isKeyFile ) {
    console.error( `[E] Could not open '${cmdArgs.key}'. Exiting ...` );
    Deno.exit( -3 );
  }
  serverOptions.key = Deno.readTextFileSync(cmdArgs.key);
  proto = "https";
}

function getPathFromRequest(req: Request): string {
  const url = new URL(req.url);
  let path = url.pathname;
  if (path === "/") path = "/index.html";
  return path.replace(/^\/+/, "");
}

Deno.serve( serverOptions, async (req: Request) => {
  const upgrade = req.headers.get("upgrade")?.toLowerCase();

  if (upgrade === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onopen = () => console.log("WS connected");
    socket.onmessage = (e) => {
      console.log("WS received:", e.data);
      socket.send(`Echo: ${e.data}`);
    };
    socket.onclose = () => console.log("WS closed");
    socket.onerror = (e) => console.error("WS error", e);
    return response;
  }

  const path : string = getPathFromRequest( req );
  
  const dynamicRoutes: Record<string, (req: Request) => Response> = {
    "index.html" : ( r ) => { return new Response(`<!DOCTYPE html>
                                                  <html>
                                                    <head>
                                                      <title>Deno GUI APP</title>
                                                      <link rel="stylesheet" href="css/style.css">
                                                    </head>
                                                    <body>
                                                      <input id="msg" placeholder="Type a message" />
                                                      <button onclick="send()">Send</button>
                                                      <ul id="log"></ul>
                                                      <script>
                                                        const ws = new WebSocket("ws://" + location.host);
                                                        ws.onmessage = (e) => {
                                                          const li = document.createElement("li");
                                                          li.textContent = e.data;
                                                          document.getElementById("log").appendChild(li);
                                                        };
                                                        function send() {
                                                          const val = document.getElementById("msg").value;
                                                          ws.send(val);
                                                        }
                                                      </script>
                                                    </body>
                                                  </html>`, 
                              {
                                headers: {
                                  "content-type": "text/html; charset=utf-8",
                                },
                              })
                            }
  };

  if ( path in dynamicRoutes ) {
    return dynamicRoutes[path](req);
  }

  const asset = STATIC_ASSETS[path];
  if (asset) {
    const decompressed = gunzip( asset.data );
    const contentType = asset.mime;
    return new Response( decompressed.slice(), {
      headers: {
        "content-type": asset.mime,
        "cache-control": "public, max-age=86400",
      },
    });
  }

  return new Response("404 Not Found", { status: 404 });
} );





if ( cmdArgs.browser === true || typeof cmdArgs.browser === 'string' ) {
  const URL = `${proto}://${cmdArgs.host}:${port}`;

  async function openBrowser(url: string) {
    if ( typeof cmdArgs.browser === 'string' ) {
      try {
        await new Deno.Command(cmdArgs.browser, {
            args: [url],
            stdout: "null",
            stderr: "null",
          }).spawn();
      } catch ( err ) {
        console.warn( `[W] Could not open the GUI using the browser you specified.\n
          Here is the Deno exception:\n`, err );
      }
    } else {
      const cmds: Record<string, string[]> = {
        windows: ["cmd", "/c", "start", "", url],
        darwin: ["open", url],
        linux: ["xdg-open", url],
      };
      const cmd = cmds[Deno.build.os];
      if (cmd) {
        await new Deno.Command(cmd[0], {
          args: cmd.slice(1),
          stdout: "null",
          stderr: "null",
        }).spawn();
      } else {
        console.warn("[W] Unsupported OS: Can not open browser automatically!");
      }
    }
  }

  openBrowser(URL);
}