export type {
  BlockCategory,
  BlockSlot,
  BlockDefinition,
  BlockInstantiateParams,
  SlotType,
} from './types';
export { ALL_BLOCK_CATEGORIES } from './types';

export {
  registerBlock,
  getBlock,
  removeBlock,
  listBlocks,
  searchBlocks,
  listBlockNames,
  blockCount,
  clearBlocks,
} from './registry';

export {
  saveBlock,
  loadBlock,
  deleteBlockFile,
  loadBlocksFromDisk,
  listBlockFiles,
} from './io';

export {
  instantiateBlock,
  type InstantiateResult,
} from './instantiate';

export { registerStarterBlocks } from './starter';
