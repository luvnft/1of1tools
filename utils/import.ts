import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { addBoutiqueCollectionEvent, setBoutiqueCollectionStats } from "db";
import { TransactionType } from "helius-sdk";
import { Collection, CollectionFloor } from "models/collection";
import { NFTEvent, OneOfOneNFTEvent, oneOfOneNFTEvent } from "models/nftEvent";
import { err, ok, Result } from "neverthrow";
import { notEmpty } from "utils";
import { recalculateFloorPrice } from "./floorPrice";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";

export const importAllEventsForCollection = async (
  collection: Collection
): Promise<
  Result<
    {
      totalVolume: number;
      monthVolume: number;
      weekVolume: number;
      dayVolume: number;
      athSale: OneOfOneNFTEvent | undefined;
      floor: CollectionFloor | null;
    },
    Error
  >
> => {
  let totalVolume = 0;
  let monthVolume = 0;
  let dayVolume = 0;
  let weekVolume = 0;

  const nowInSeconds = new Date().getTime() / 1000;
  const dayInSeconds = 60 * 60 * 24;

  let paginationToken = null;

  let query: any = {
    types: [
      TransactionType.NFT_BID,
      TransactionType.NFT_BID_CANCELLED,
      TransactionType.NFT_LISTING,
      TransactionType.NFT_CANCEL_LISTING,
      TransactionType.NFT_SALE,
      TransactionType.NFT_MINT,
      TransactionType.NFT_AUCTION_CREATED,
      TransactionType.NFT_AUCTION_UPDATED,
      TransactionType.NFT_AUCTION_CANCELLED,
      TransactionType.NFT_PARTICIPATION_REWARD,
      TransactionType.NFT_MINT_REJECTED,
      TransactionType.NFT_GLOBAL_BID,
      TransactionType.NFT_GLOBAL_BID_CANCELLED,
      TransactionType.BURN,
      TransactionType.BURN_NFT,
      TransactionType.TRANSFER,
      TransactionType.STAKE_TOKEN,
      TransactionType.UNSTAKE_TOKEN,
    ],
    nftCollectionFilters: {},
  };

  if (collection.firstVerifiedCreator) {
    query.nftCollectionFilters.firstVerifiedCreator = [
      collection.firstVerifiedCreator,
    ];
  } else if (collection.collectionAddress) {
    query.nftCollectionFilters.verifiedCollectionAddress = [
      collection.collectionAddress,
    ];
  } else {
    console.log(
      `Collection ${collection.name} has neither a verified collection address or verified creator address`
    );
    return err(new Error("Failed to load listings"));
  }

  let options: { [key: string]: any } = {
    limit: 1000,
  };

  let athSale: OneOfOneNFTEvent | undefined;

  do {
    if (paginationToken) {
      options["paginationToken"] = paginationToken;
    }

    const response = await fetch(
      `https://api.helius.xyz/v1/nft-events?api-key=${HELIUS_API_KEY}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          options: options,
        }),
      }
    );

    const responseJSON: any = await response.json();

    if (!response.ok) {
      return err(new Error(responseJSON.error));
    }

    const events = responseJSON.result as NFTEvent[];
    events
      .map((e) => oneOfOneNFTEvent(e))
      .filter(notEmpty)
      .forEach(async (event) => {
        if (collection.mintAddresses.includes(event.mint)) {
          if (
            [TransactionType.NFT_SALE, TransactionType.NFT_MINT].includes(
              event.type as TransactionType
            )
          ) {
            const solAmount = event.amount / LAMPORTS_PER_SOL;

            totalVolume += solAmount;

            if (event.timestamp > nowInSeconds - dayInSeconds) {
              dayVolume += solAmount;
            }
            if (event.timestamp > nowInSeconds - 30 * dayInSeconds) {
              monthVolume += solAmount;
            }
            if (event.timestamp > nowInSeconds - 7 * dayInSeconds) {
              weekVolume += solAmount;
            }
            if (!athSale || event.amount > athSale.amount) {
              athSale = event;
            }
          }

          const result = await addBoutiqueCollectionEvent(
            collection.slug,
            event
          );
          if (result.isErr()) {
            console.error(result.error.message);
          }
        }
      });

    paginationToken = responseJSON.paginationToken;
  } while (paginationToken);

  // determine floor price
  const floorRes = await recalculateFloorPrice(collection);
  if (!floorRes.isOk()) {
    console.error("Failed to get floor: " + floorRes.error.message);
  }

  const floor = floorRes.isOk() ? floorRes.value : null;
  console.log(
    `Saving floor of collection: ${collection.name} as ${floor?.listing.amount}`
  );

  // save all data
  const setTotalVolumeRes = await setBoutiqueCollectionStats(
    collection.slug,
    totalVolume,
    monthVolume,
    weekVolume,
    dayVolume,
    athSale ?? null,
    floor
  );
  if (!setTotalVolumeRes.isOk()) {
    return err(new Error("Failed to set collection total volume."));
  }

  return ok({
    totalVolume: totalVolume,
    monthVolume: monthVolume,
    weekVolume: weekVolume,
    dayVolume: dayVolume,
    athSale: athSale,
    floor: floor,
  });
};
