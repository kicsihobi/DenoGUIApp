import { parseArgs } from "jsr:@std/cli/parse-args";

import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";





const cmdArgs = parseArgs( Deno.args, {
  boolean  : ['help', 'verbose'],
  string   : ['folder', 'output', 'threads'],
  alias    : { help: 'h', verbose: 'v', folder: 'f', ignore: 'i', output: 'o', threads: 't' },
  default  : {
    folder : '.',
    ignore : 'ignoreasset',
    output : 'static_assets.js',
    threads: '4'
  },
  unknown   : ( arg, key, value ) => console.warn( `[W] Unknown argument: ${ ( key !== undefined ) ? key + '=' + value : arg }` )
} );



function verbose( ...data ) {
  if ( cmdArgs.verbose === true ) {
    console.log( ...data );
  }
}
verbose( '[I] Verbose messages enabled.\nArguments:', cmdArgs );



const helpMessage = `Usage: deno run [--allow-read] [--allow-write] [options]

Options:
  --folder,  -f <path>  Root folder to embed assets from (default: .)
  --ignore,  -i <file>  Blacklist file (default: ignoreasset)
  --output,  -o <file>  Output file (default: static_assets.js, use "STDOUT" for console)
  --threads, -t <n>     Number of compression workers (default: 4)
  --verbose, -v         Enable verbose debug output
  --help,    -h         Show this help message
`;

if( cmdArgs.help === true ) {
  console.log( helpMessage );
  Deno.exit( );
}



const threadCount = parseInt( cmdArgs.threads );
/** @todo check if output can be created if not STDOUT */



async function fileExists( path ) {
  try {
    const stats = await Deno.lstat( path );
  } catch ( err ) {
    verbose( '[I] Exception when checking file existence:', err );
    return false;
  }
  return true;
}

const blacklist = ( ( ) => {
  if( fileExists( cmdArgs.ignore ) ) {
    const content = Deno.readTextFileSync( `${cmdArgs.ignore}` );
    const lines = content.split( "\n" ).map( ( l ) => l.trim( ) ).filter( Boolean );
    lines.push( cmdArgs.ignore );
    verbose( `[I] Using ignore list from: ${cmdArgs.ignore}` );
    return new Set(lines);
  } else {
    verbose( '[I] No ignore file found, continuing without it.' );
    return new Set([cmdArgs.ignore]);
  }
}) ( );

function isBlacklisted( path ) {
  return [...blacklist].some( ( b ) => path.includes( b ) );
}



const collected = [];

async function walk( current, base = "" ) {
  for await ( const entry of Deno.readDir( current ) ) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = `${current}/${entry.name}`;
    if ( isBlacklisted( rel ) ) {
      verbose( `[I] Skipped file: ${rel}` );
      continue;
    }
    if ( entry.isDirectory ) {
      await walk( full, rel );
    } else {
      collected.push( { fullPath: full, relativePath: rel } );
      verbose( `[I] Added file: ${rel}` );
    }
  }
}

verbose( '[I] Collecting asset files.' );
await walk( cmdArgs.folder );
verbose( `[I] Collected ${collected.length} files.` );

const workerSrc = `
  import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
  self.onmessage = (e) => {
    const { relativePath, fileData, originalSize } = e.data;
    const gz = gzip( new Uint8Array( fileData ) );
    self.postMessage( { relativePath, gz, originalSize } );
  };
`;

const workers = Array.from({ length: threadCount }, () =>
  new Worker(
    URL.createObjectURL(new Blob([workerSrc], { type: "application/javascript" })),
    { type: "module" }
  )
);

let taskIndex = 0;
function getNextWorker( ) {
  return workers[taskIndex++ % workers.length];
}

const pending = [];
const outputChunks = [];
const assetMap = {}; // path → varname

function chunkArray( arr, size ) {
  const chunks = [];
  for ( let i = 0; i < arr.length; i += size ) {
    chunks.push( arr.slice( i, i + size ) );
  }
  return chunks;
}

const chunks = chunkArray(collected, threadCount);

for (const batch of chunks) {
  verbose( `[I] Processing batch of ${batch.length} files...` );

  const tasks = batch.map( async ( { fullPath, relativePath } ) => {
    const bytes = await Deno.readFile( fullPath );
    const originalSize = bytes.length;

    return new Promise( ( resolve ) => {
      const worker = new Worker(
        URL.createObjectURL( new Blob([workerSrc], { type: "application/javascript" } ) ),
        { type: "module" }
      );

      worker.onmessage = ( { data } ) => {
        const varName = data.relativePath.replace( /\W+/g, "_" ).replace( /^(\d)/, "_$1" ) + "_gz";
        assetMap[data.relativePath] = varName;
        verbose( `[I] Compressed ${data.relativePath} (${data.originalSize} -> ${data.gz.length} bytes)` );
        const lines = [
          `// ${data.relativePath} (gzipped)`,
          `export const ${varName} = new Uint8Array( [`,
        ];
        for ( let i = 0; i < data.gz.length; i += 100 ) {
          lines.push( "  " + data.gz.slice( i, i + 100 ).join( ", " ) + "," );
        }
        lines.push( "] );\n" );
        resolve( lines.join( "\n" ) );
        worker.terminate( );
      };

      worker.postMessage( { relativePath, fileData: bytes.buffer, originalSize }, [bytes.buffer] );
    });
  });

  const results = await Promise.all( tasks );
  outputChunks.push( ...results );
}

const compressedSnippets = await Promise.all( pending );

outputChunks.push( ...compressedSnippets );

outputChunks.push( "export const STATIC_ASSETS = {" );


function mimeTypeFromExtension( path ) {
  const ext = path.split( "." ).pop( ).toLowerCase( );
  switch (ext) {
    case "html" : return "text/html; charset=utf-8";
    case "css"  : return "text/css";
    case "js"   : return "application/javascript";
    case "json" : return "application/json";
    case "png"  : return "image/png";
    case "jpg"  :
    case "jpeg" : return "image/jpeg";
    case "gif"  : return "image/gif";
    case "svg"  : return "image/svg+xml";
    case "ico"  : return "image/x-icon";
    case "woff" : return "font/woff";
    case "woff2": return "font/woff2";
    case "ttf"  : return "font/ttf";
    case "otf"  : return "font/otf";
    case "txt"  : return "text/plain";
    case "webp" : return "image/webp";
    default     : return "application/octet-stream";
  }
}


for ( const [ relativePath, varName ] of Object.entries( assetMap ) ) {

  const mime = mimeTypeFromExtension( relativePath );
  outputChunks.push( `  ${JSON.stringify( relativePath )}: {` );
  outputChunks.push( `    mime: ${JSON.stringify( mime )},` );
  outputChunks.push( `    data: ${varName}` );
  outputChunks.push( `  },`);
}
outputChunks.push( "};\n" );

if ( cmdArgs.output === "STDOUT" ) {
  console.log( outputChunks.join( "\n" ) );
  verbose( '[I] Output written to STDOUT' );
} else {
  await Deno.writeTextFile( cmdArgs.output, outputChunks.join( "\n" ) );
  verbose( `[I] Output written to ${cmdArgs.output}` );
}

for ( const worker of workers ) {
  worker.terminate( );
}
