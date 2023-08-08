import {DownloadPgmOpts} from './onDownloadAction';
import {container} from "tsyringe";
import { AbrgError, AbrgErrorLevel, CkanDownloader } from '../domain';
import  {MESSAGE} from './strResource';
import { getDataDir } from '../infrastructure';
import { Logger } from 'winston';
import { setupContainer, StrResource } from '../config/setupContainer';

export const onUpdateCheckAction = async (options: DownloadPgmOpts) => {
  
  const dataDir = await getDataDir(options.dataDir);
  const ckanId = options.resourceId;
  await setupContainer({
    dataDir,
    ckanId,
  });

  const strResource: StrResource = container.resolve('strResource');
  const logger = container.resolve<Logger>('Logger');
  const downloader = container.resolve(CkanDownloader);
  const {updateAvailable} = await downloader.updateCheck({
    ckanId,
  });

  logger.info(
    strResource(
      MESSAGE.NEW_DATASET_IS_AVAILABLE,
    ),
  );
  if (!updateAvailable) {
    return Promise.reject(
      new AbrgError({
        messageId: MESSAGE.ERROR_NO_UPDATE_IS_AVAILABLE,
        level: AbrgErrorLevel.INFO,
      }),
    );
  }
  logger.info(
    strResource(
      MESSAGE.NEW_DATASET_IS_AVAILABLE,
    ),
  );
};