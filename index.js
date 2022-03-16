const RateLimiter = require("limiter").RateLimiter
const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const limiter = new RateLimiter({ tokensPerInterval: 10, interval: 1000 });


// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

const theFolderId = process.argv[2]
const userEmail = process.argv[3]

if (!theFolderId || !userEmail) {
    console.log('Both a folder ID and user email must be provided!');
    process.exit()
}

let drive = null

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Drive API.
  authorize(JSON.parse(content), start);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function traverseFiles(parentId) {

  drive.files.list({
    pageSize: 1000,
    fields: 'nextPageToken, files(id, name, permissions, mimeType, kind)',
    q: `'${parentId}' in parents`
  }, (err, res) => {

    if (err) return console.log('The API returned an error: ' + err);

    const files = res.data.files;

    if (files.length) {
      console.log('Files:');

      files.forEach((file) => {

        if (file.kind !== 'drive#file') {
            return
        }

        console.log(`${file.name} (${file.id})`);

        transferOwnership(file)

        if (file.mimeType === 'application/vnd.google-apps.folder') {
            traverseFiles(file.id)
        }
      });

      console.log(`Total ${files.length} files found`);

    } else {
      console.log('No (more) files found.');
    }
  });
}

let currentUser = null

function start(auth) {
    drive = google.drive({version: 'v3', auth});

    var oauth2 = google.oauth2({
        auth: auth,
        version: 'v2'
    });

    oauth2.userinfo.get(function(err, res) {
        if (err) {
            console.log(err);
        } else {
            currentUser = res
            traverseFiles(theFolderId)
        }
    });

}

function transferOwnership(file) {
    const userIsAlreadyOwner = file.permissions.find((permission) => {
        return permission.emailAddress === userEmail && permission.role === 'owner'
    })

    if (userIsAlreadyOwner) {
        console.log(`User ${userEmail} is already owner of the file ${file.id} ${file.name}`)
        return
    }

    const userPermissions = file.permissions.find((permission) => {
        return permission.emailAddress === userEmail
    })

    if (!userPermissions) {
        console.log(`User ${userEmail} does not have access to file ${file.id} ${file.name}`)
        return
    }

    if (userPermissions.pendingOwner) {
        console.log(`User ${userEmail} is already pending ownership for ${file.id} ${file.name}`)
        return
    }

    const currentUserPermissions = file.permissions.find((permission) => {
        return permission.emailAddress === currentUser.data.email && permission.role === 'owner'
    })

    if (!currentUserPermissions) {
        console.log(`Current user is not the owner of ${file.id} ${file.name}`)
        return
    }

    drive.permissions.update({
        fileId: file.id,
        permissionId: userPermissions.id,
        resource: {
            role: 'writer',
            pendingOwner: true,
        }
    }, (err, res) => {

        if (err) {
            console.log(err)
            return console.log('The API returned an error: ' + err);
        }

        console.log('Owner transfer initiated')
    })

}

// TODO: implement rate-limiting, if possible, based on https://www.useanvil.com/blog/engineering/throttling-and-consuming-apis-with-429-rate-limits/
// TODO: implement transfer approval as well
