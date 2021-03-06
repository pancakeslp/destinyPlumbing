const objectDiff = require('objectdiff');
const _ = require('lodash');
const { chain, forEach, sortBy, isEqual } = require('lodash');
const axios = require('axios');

const fileManager = require('../fileManager');
const { openJSON, listS3, mapPromiseAll } = require('../utils');
const diffHtmlTemplate = require('./diffHtmlTemplate');

const { FORCE_PREVIOUS_ID } = process.env;

function createDiffs(defName, current, previous, lang, defs) {
  if (!current) {
    throw new Error('Current items is undefined');
  }

  if (!previous) {
    throw new Error('Previous items is undefined');
  }

  console.log(
    `Running diff for ${defName} with`,
    Object.keys(current).length,
    'current items, and',
    Object.keys(previous).length,
    'previous items',
  );

  const templateDiffData = {
    new: [],
    unclassified: [],
    changed: [],
  };

  forEach(current, item => {
    const prevItem = previous[item.hash];
    if (!prevItem) {
      templateDiffData.new.push(item);
    } else if (
      prevItem.redacted &&
      !item.redacted &&
      item.displayProperties.name
    ) {
      templateDiffData.unclassified.push(item);
    } else if (!isEqual(item, prevItem)) {
      templateDiffData.changed.push(item);
    } else {
    }
  });

  const sorter = item =>
    item.itemCategoryHashes ? item.itemCategoryHashes.join(',') : 0;

  templateDiffData.new = _.sortBy(templateDiffData.new, sorter);
  templateDiffData.unclassified = _.sortBy(
    templateDiffData.unclassified,
    sorter,
  );
  templateDiffData.changed = _.sortBy(templateDiffData.changed, sorter);

  const friendlyDiff = {
    new: templateDiffData.new.map(item => item.hash),
    unclassified: templateDiffData.unclassified.map(item => item.hash),
    changed: templateDiffData.changed.map(item => item.hash),
  };

  const newHtmlPage =
    templateDiffData.new.length > 0 &&
    diffHtmlTemplate(
      defName,
      templateDiffData.new,
      {
        ...defs,
        itemDefs: current,
      },
      'New data',
      [
        templateDiffData.changed.length > 0 && {
          text: 'Changed data',
          link: 'changed.html',
        },
      ],
    );

  const newHtmlPagePromise = newHtmlPage
    ? fileManager.saveFile([lang, 'diff', defName, 'diff.html'], newHtmlPage, {
        raw: true,
      })
    : Promise.resolve();

  const changedHtmlPage =
    templateDiffData.new.length > 0 &&
    diffHtmlTemplate(
      defName,
      templateDiffData.changed,
      {
        ...defs,
        itemDefs: current,
      },
      'Changed data',
      [
        templateDiffData.new.length > 0 && {
          text: 'New data',
          link: 'diff.html',
        },
      ],
    );

  const changedHtmlPagePromise = changedHtmlPage
    ? fileManager.saveFile(
        [lang, 'diff', defName, 'changed.html'],
        changedHtmlPage,
        {
          raw: true,
        },
      )
    : Promise.resolve();

  return Promise.resolve([
    fileManager.saveFile(
      [lang, 'diff', defName, 'friendly.json'],
      friendlyDiff,
    ),
    // fileManager.saveFile([lang, 'diff', defName, 'deep.json'], bigDiff),
    newHtmlPagePromise,
    changedHtmlPagePromise,
  ]);
}

function getPreviousDef(defName, lang, previousId) {
  const itemsUrl = `https://s3.amazonaws.com/destiny.plumbing/versions/${previousId}/${lang}/raw/${defName}.json`;
  console.log(`Fetching previous def ${defName} for ID`, previousId);
  return axios.get(itemsUrl).then(r => r.data);
}

function getPreviousId() {
  if (FORCE_PREVIOUS_ID) {
    return Promise.resolve(FORCE_PREVIOUS_ID);
  }

  return listS3('versions/', '/')
    .then(_keys => {
      const keys = _keys.filter(k => {
        return !k.includes(global.HACKY_MANIFEST_ID);
      });
      return Promise.all(
        keys.map(k =>
          axios.get(`https://s3.amazonaws.com/destiny.plumbing/${k}index.json`),
        ),
      );
    })
    .then(_allIndexes => {
      const allIndexes = _allIndexes.map(r => r.data);
      const sorted = sortBy(allIndexes, index => {
        return new Date(index.lastUpdated);
      }).reverse();

      const history = sorted.map(data => {
        return {
          id: data.id,
          lastUpdated: data.lastUpdated,
          bungieManifestVersion: data.bungieManifestVersion,
        };
      });

      fileManager.saveFile(['history.json'], history);

      const prevIndex = sorted[0];
      return prevIndex.id;
    });
}

const DEFINITIONS = [
  // 'DestinyActivityDefinition',
  // 'DestinyActivityModeDefinition',
  'DestinyInventoryItemDefinition',

  // 'DestinyAchievementDefinition',
  // 'DestinyActivityGraphDefinition',
  // 'DestinyActivityModifierDefinition',
  // 'DestinyActivityTypeDefinition',
  // 'DestinyBondDefinition',
  // 'DestinyChecklistDefinition',
  // 'DestinyClassDefinition',
  // 'DestinyDamageTypeDefinition',
  // 'DestinyDestinationDefinition',
  // 'DestinyEnemyRaceDefinition',
  // 'DestinyEquipmentSlotDefinition',
  // 'DestinyFactionDefinition',
  // 'DestinyGenderDefinition',
  // 'DestinyHistoricalStatsDefinition',
  // 'DestinyInventoryBucketDefinition',
  // 'DestinyItemCategoryDefinition',
  // 'DestinyItemTierTypeDefinition',
  // 'DestinyLocationDefinition',
  // 'DestinyLoreDefinition',
  // 'DestinyMaterialRequirementSetDefinition',
  // 'DestinyMedalTierDefinition',
  // 'DestinyMilestoneDefinition',
  // 'DestinyObjectiveDefinition',
  // 'DestinyPlaceDefinition',
  // 'DestinyPlugSetDefinition',
  // 'DestinyProgressionDefinition',
  // 'DestinyProgressionLevelRequirementDefinition',
  // 'DestinyRaceDefinition',
  // 'DestinyReportReasonCategoryDefinition',
  // 'DestinySackRewardItemListDefinition',
  // 'DestinySandboxPerkDefinition',
  // 'DestinySocketCategoryDefinition',
  // 'DestinySocketTypeDefinition',
  // 'DestinyStatDefinition',
  // 'DestinyStatGroupDefinition',
  // 'DestinyTalentGridDefinition',
  // 'DestinyUnlockDefinition',
  // 'DestinyVendorDefinition',
  // 'DestinyVendorGroupDefinition',
];

function diffDefinition(pathPrefix, definitionName, lang, previousId, defs) {
  return Promise.all([
    openJSON(`${pathPrefix}/raw/${definitionName}.json`),
    getPreviousDef(definitionName, lang, previousId),
  ])
    .then(([current, previous]) => {
      return createDiffs(definitionName, current, previous, lang, defs);
    })
    .catch(err => {
      console.error('Error in diff, but ignoring:');
      console.error(err);

      return Promise.resolve();
    });
}

module.exports = function createItemDumps(pathPrefix, lang) {
  if (lang !== 'en') {
    return Promise.resolve();
  }

  return Promise.all([
    getPreviousId(),
    openJSON(`${pathPrefix}/raw/DestinyItemCategoryDefinition.json`),
    openJSON(`${pathPrefix}/raw/DestinyDamageTypeDefinition.json`),
    openJSON(`${pathPrefix}/raw/DestinyInventoryBucketDefinition.json`),
    openJSON(`${pathPrefix}/raw/DestinyInventoryItemDefinition.json`),
  ])
    .then(([previousId, itemCategory, damageType, bucket, inventoryItem]) => {
      return mapPromiseAll(DEFINITIONS, definitionName => {
        return diffDefinition(pathPrefix, definitionName, lang, previousId, {
          itemCategory,
          damageType,
          bucket,
          inventoryItem,
        });
      });
    })
    .then(() => {
      return Promise.all([
        getPreviousId(),
        openJSON(`${pathPrefix}/raw/DestinyCollectibleDefinition.json`),
      ])
        .then(([previousId, collectibles]) => {
          return Promise.all([
            previousId,
            collectibles,
            getPreviousDef('DestinyCollectibleDefinition', lang, previousId),
          ]);
        })
        .then(([previousId, currentCollectibles, previousCollectibles]) => {
          const currentSourceStrings = _(currentCollectibles)
            .map(c => c.sourceString)
            .filter(Boolean)
            .uniq()
            .value();

          const previousSourceStrings = _(previousCollectibles)
            .map(c => c.sourceString)
            .filter(Boolean)
            .uniq()
            .value();

          const newSourceStrings = currentSourceStrings.filter(sourceString => {
            return !previousSourceStrings.includes(sourceString);
          });

          return fileManager.saveFile(
            [lang, 'diff', 'collectibleSourceStrings.json'],
            { new: newSourceStrings },
          );
        });
    });
};
