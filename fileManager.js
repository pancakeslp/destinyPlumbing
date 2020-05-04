const pathLib = require('path');
const { resolveCb, writeFile, uploadToS3 } = require('./utils');
const _ = require('lodash');
const async = require('async');

const manifestStore = [];

const PATH_PREFIX = process.env.PATH_PREFIX;

if (!global.HACKY_THIS_ID) {
  global.HACKY_THIS_ID = '123def';
}

function pathsFromArray(path) {
  const finalPath = PATH_PREFIX ? [PATH_PREFIX, ...path] : path;

  const filePath = pathLib.join('data', ...finalPath);
  const s3Key = finalPath.join('/');
  const versionedS3Key = pathLib.join(
    'versions',
    global.HACKY_MANIFEST_ID,
    ...finalPath,
  );
  const versionedFilePath = pathLib.join(
    'data',
    'versions',
    global.HACKY_MANIFEST_ID,
    ...finalPath,
  );

  return {
    filePath,
    s3Key,
    versionedS3Key,
    versionedFilePath,
  };
}

function saveFileWorker(task, cb) {
  const { path, obj, raw } = task;

  const { filePath, s3Key, versionedS3Key, versionedFilePath } = pathsFromArray(
    path,
  );

  const fileBody = raw ? obj : JSON.stringify(obj);

  manifestStore.push({ path, filePath, s3Key, obj });

  const id = path.join('.');
  console.log(id, 'uploading to', s3Key);

  const contentType = s3Key.includes('.html')
    ? 'text/html'
    : 'application/json';

  const promises = [
    //uploadToS3(s3Key, fileBody, { ContentType: contentType }),
    //uploadToS3(versionedS3Key, fileBody, { ContentType: contentType }),
    writeFile(filePath, fileBody),
    writeFile(versionedFilePath, fileBody),
  ];

  return Promise.all(promises)
    .then(() => {
      console.log(id, 'successfully saved');
      cb();
    })
    .catch(err => {
      console.error(err);

      const failedCount = (task.failedCount || 0) + 1;

      if (failedCount < 10) {
        console.error('Error uploading file to S3, going to retry');
        fileUploadQueue.push({
          ...task,
          failedCount,
        });
      } else {
        console.error('Error uploading file to S3 too many times, aborting');
        cb(new Error('Error uploading file to S3 too many times, aborting'));
      }
    });
}

const fileUploadQueue = async.queue(saveFileWorker, 15);

module.exports.saveFile = function saveFileQueuer(path, obj, extra = {}) {
  return new Promise((resolve, reject) => {
    fileUploadQueue.push({ path, obj, ...extra }, resolveCb(resolve, reject));
  });
};

module.exports.collectManifest = function collectManifest() {
  const manifest = manifestStore.reduce((acc, file) => {
    const [...path] = file.path;
    const fileName = path[path.length - 1].split('.')[0];
    path[path.length - 1] = fileName;

    const objectPath = path.join('.');
    const url = `https://s3.amazonaws.com/destiny.plumbing/${file.s3Key}`;
    _.set(acc, objectPath, url);

    return acc;
  }, {});

  return manifest;
};

module.exports.saveManifest = function saveManifest(extraData = {}) {
  const manifest = Object.assign(extraData, module.exports.collectManifest());

  const { filePath, s3Key, versionedS3Key, versionedFilePath } = pathsFromArray(
    ['index.json'],
  );

  const fileBody = JSON.stringify(manifest, null, 2);

  writeFile(filePath, fileBody);
  writeFile(versionedFilePath, fileBody);
  uploadToS3(versionedS3Key, fileBody, { ContentType: 'application/json' });

  const prom = uploadToS3(s3Key, fileBody, {
    ContentType: 'application/json',
  });

  return prom;
};
