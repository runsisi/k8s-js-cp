const fs = require('fs');
const buffers = require('stream-buffers');
const tar = require('tar');
const tmp = require('tmp-promise');
const querystring = require('querystring');

const WritableStreamBuffer = buffers.WritableStreamBuffer;

const namespace = 'default';
const podName = 'cat';
const containerName = 'cat';
const srcPath = './test.txt';
const tgtPath = '/tmp';

let protocols = [
    'v5.channel.k8s.io',
    'v4.channel.k8s.io',
    'v3.channel.k8s.io',
    'v2.channel.k8s.io',
    'channel.k8s.io',
];

const StdinStream = 0;
const StdoutStream = 1;
const StderrStream = 2;
const StatusStream = 3;
const ResizeStream = 4;
const CloseStream = 255;

function supportsClose(protocol) {
    return protocol === 'v5.channel.k8s.io';
}

function closeStream(streamNum, streams) {
    switch (streamNum) {
    case StdinStream:
        streams.stdin.pause();
        break;
    case StdoutStream:
        streams.stdout.end();
        break;
    case StderrStream:
        streams.stderr.end();
        break;
    }
}

function copyChunkForWebSocket(
    streamNum,
    chunk,
    encoding,
) {
    let buff;

    if (chunk instanceof Buffer) {
        buff = Buffer.alloc(chunk.length + 1);
        chunk.copy(buff, 1);
    } else {
        encoding = 'utf-8';
        const size = Buffer.byteLength(chunk, encoding);
        buff = Buffer.alloc(size + 1);
        buff.write(chunk, 1, size, encoding);
    }

    buff.writeInt8(streamNum, 0);
    return buff;
}

function handleStandardStreams(
    streamNum,
    buff,
    stdout,
    stderr,
) {
    console.log('handleStandardStreams', streamNum, buff);
    if (buff.length < 1) {
        return null;
    }
    if (stdout && streamNum === StdoutStream) {
        stdout.write(buff);
    } else if (stderr && streamNum === StderrStream) {
        stderr.write(buff);
    } else if (streamNum === StatusStream) {
        // stream closing.
        // Hacky, change tests to use the stream interface
        if (stdout && stdout !== process.stdout) {
            stdout.end();
        }
        if (stderr && stderr !== process.stderr) {
            stderr.end();
        }
        return JSON.parse(buff.toString('utf8'));
    } else {
        throw new Error('Unknown stream: ' + streamNum);
    }
    return null;
}

function handleStandardInput(
    ws,
    stdin,
    streamNum,
) {
    stdin.on('data', (data) => {
        console.log('copy to stdin', data.length, data);
        ws.send(copyChunkForWebSocket(streamNum, data, stdin.readableEncoding));
    });

    stdin.on('end', () => {
        console.log('stdin EOF');
        if (supportsClose(ws.protocol)) {
            console.log('initiate ws close');
            const buff = Buffer.alloc(2);
            buff.writeUint8(CloseStream, 0);
            buff.writeUint8(StdinStream, 1);
            ws.send(buff);
            return;
        }
        ws.close();
    });
    // Keep the stream open
    return true;
}

async function connect(
    path,
    textHandler,
    binaryHandler,
) {
    const target = '10.0.1.105';
    const proto = 'ws';
    const uri = `${proto}://${target}${path}`;

    const opts = {
        headers: {},
    };

    console.log('connecting..');

    return await new Promise((resolve, reject) => {
        console.log('websocket connecting..', uri);

        protocols.unshift('base64url.bearer.authorization.k8s.io.ZXlKaGJHY2lPaUpTVXpJMU5pSXNJbXRwWkNJNklqSTNlV1IzYUVkTVgxSXljbXRaWmxRNVkxZFZMUzFvVUVST1dGRk1ObG8wTXpCV2FFSnpjbEpQTTBVaWZRLmV5SnBjM01pT2lKcmRXSmxjbTVsZEdWekwzTmxjblpwWTJWaFkyTnZkVzUwSWl3aWEzVmlaWEp1WlhSbGN5NXBieTl6WlhKMmFXTmxZV05qYjNWdWRDOXVZVzFsYzNCaFkyVWlPaUpyZFdKbExYTjVjM1JsYlNJc0ltdDFZbVZ5Ym1WMFpYTXVhVzh2YzJWeWRtbGpaV0ZqWTI5MWJuUXZjMlZqY21WMExtNWhiV1VpT2lKNFkzVmlaUzFoWkcxcGJpSXNJbXQxWW1WeWJtVjBaWE11YVc4dmMyVnlkbWxqWldGalkyOTFiblF2YzJWeWRtbGpaUzFoWTJOdmRXNTBMbTVoYldVaU9pSjRZM1ZpWlMxaFpHMXBiaUlzSW10MVltVnlibVYwWlhNdWFXOHZjMlZ5ZG1salpXRmpZMjkxYm5RdmMyVnlkbWxqWlMxaFkyTnZkVzUwTG5WcFpDSTZJamd6TmpKaVl6WTVMVGxtTTJVdE5EazBNQzA0T1dGbUxXVXpZbUZrTldVeE9XVTBOeUlzSW5OMVlpSTZJbk41YzNSbGJUcHpaWEoyYVdObFlXTmpiM1Z1ZERwcmRXSmxMWE41YzNSbGJUcDRZM1ZpWlMxaFpHMXBiaUo5LmxKR0pGTG5FRFBMTmpxR1pLal9PQkFoMkV6cVE2ZG9kR3YwWmVtZGdpR21GVDhkZGhGZkRLQUJNQ3czaUlhYk85d2MxQjdHS255MmN0dmZHakhRc3JEekpGNkZDSDBqNnRUV2xrQkoxa1JPRmF5eHhZOUZsQUU3dnctRVBpTGhsUUpiYnNYTTNDb25TQjN2V1FvZFNyQ3pxQXFoVmZLZFFZSUJhcmxDTDVRSl8zX29fQ1haTUdPWmw2VnJMdzNTTHJDRTJTUnV2RW1MUkRhTWNYM21HUWNBbkg0eXo2U1hMcV9oWDJ0N3ItMm9ZTWtQaE56dzMzMzVPd1o1XzFZUVctTUVRNUtqdl9lOGdWMXpFSGs1Q1Vla3NubzFTZUVFN2xMS1dGZzA4cFMzQ2ZwYWlQdW9jQ2tnc0Z2NjdScHo1U2J6VGpZYWVmQTlERjdqYkdxN1VwZw')
        const client = new WebSocket(uri, protocols, opts);
        let resolved = false;

        console.log('websocket connected..');

        client.onopen = () => {
            console.log('websocket onopen..');
            resolved = true;
            resolve(client);
        };

        client.onerror = (err) => {
            console.log('websocket onerror..', err);
            if (!resolved) {
                reject(err);
            }
        };

        client.onclose = () => {
            console.log('websocket onclose...');
        }

        client.onmessage = ({ data }) => {
            console.log('websocket onmessage..', data);
            // TODO: support ArrayBuffer and Buffer[] data types?
            if (typeof data === 'string') {
                if (data.charCodeAt(0) === CloseStream) {
                    closeStream(data.charCodeAt(1), this.streams);
                }
                if (textHandler && !textHandler(data)) {
                    client.close();
                }
            } else if (data instanceof Buffer) {
                const streamNum = data.readUint8(0);
                if (streamNum === CloseStream) {
                    closeStream(data.readInt8(1), this.streams);
                }
                if (binaryHandler && !binaryHandler(streamNum, data.slice(1))) {
                    client.close();
                }
            }
        };
    });
}

(async () => {
    const tmpFile = tmp.fileSync();
    const tmpFileName = tmpFile.name;
    const command = ['tar', 'xf', '-', '-C', tgtPath];
    await tar.c(
        {
            file: tmpFile.name,
        },
        [srcPath],
    );
    const stdin = fs.createReadStream(tmpFileName);
    const stdout = null;
    const stderr = new WritableStreamBuffer();
    const tty = false;

    const statusCallback = async () => {
        if (stderr.size()) {
            throw new Error(`Error from cpToPod - details: \n ${stderr.getContentsAsString()}`);
        }
    };

    const query = {
        stdout: stdout != null,
        stderr: stderr != null,
        stdin: stdin != null,
        tty,
        command,
        container: containerName,
    };
    const queryStr = querystring.stringify(query);
    const path = `/api/v1/namespaces/${namespace}/pods/${podName}/exec?${queryStr}`;
    const conn = await connect(path, null, (streamNum, buff) => {
        const status = handleStandardStreams(streamNum, buff, stdout, stderr);
        if (status != null) {
            if (statusCallback) {
                statusCallback(status);
            }
            return false;
        }
        return true;
    });
    if (stdin != null) {
        handleStandardInput(conn, stdin, StdinStream);
    }
    await conn;
})();

