import { Metaplex, Nft } from "@metaplex-foundation/js";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  addAllMintsAsTracked,
  getBoutiqueCollection,
  setBoutiqueCollectionFiltersAndSize,
} from "db";
import type { NextApiRequest, NextApiResponse } from "next";
import nextConnect from "next-connect";
import { clusterApiUrl, network } from "utils/network";
import { importAllEventsForCollection } from "utils/import";
import { Helius } from "helius-sdk";
import { CloudTasksClient } from "@google-cloud/tasks";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const HELIUS_WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID || "";
const HELIUS_AUTHORIZATION_SECRET =
  process.env.HELIUS_AUTHORIZATION_SECRET || "";

const apiRoute = nextConnect<NextApiRequest, NextApiResponse<any | Error>>({
  onError(error, req, res) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  },
  onNoMatch(req, res) {
    res.status(405).json({ error: `Method '${req.method}' Not Allowed` });
  },
});

apiRoute.post(async (req, res) => {
  try {
    const { slug: slugStr } = req.query;
    const slug = slugStr?.toString();

    if (!slug || slug.length == 0) {
      res.status(400).json({ message: "slug is required." });
      return;
    }

    const collectionRes = await getBoutiqueCollection(slug);
    if (!collectionRes.isOk() || !collectionRes.value) {
      res
        .status(404)
        .json({ success: false, message: "Collection not found." });
      return;
    }

    const collection = collectionRes.value;
    if (collection.mintAddresses.length == 0) {
      res
        .status(500)
        .json({ success: false, message: "No known mint addresses." });
      return;
    }

    // determine the collection address and first creator address
    let collectionAddress = collection.collectionAddress;
    let firstVerifiedCreator = collection.firstVerifiedCreator;

    if (!collectionAddress || !firstVerifiedCreator) {
      const endpoint = clusterApiUrl(network);
      const connection = new Connection(endpoint);
      const mx = Metaplex.make(connection);
      const nft = (await mx.nfts().findByMint({
        mintAddress: new PublicKey(collection.mintAddresses[0]!),
      })) as Nft;

      collectionAddress = nft.collection?.address?.toString() ?? null;
      firstVerifiedCreator = nft.creators
        .find((c) => c.verified)
        ?.address?.toString();

      if (!firstVerifiedCreator) {
        res
          .status(500)
          .json({ success: false, message: "No verified creators." });
        return;
      }

      if (
        (!collection.collectionAddress && collectionAddress) ||
        !collection.firstVerifiedCreator
      ) {
        const setVerifiedCreatorRes = await setBoutiqueCollectionFiltersAndSize(
          slug,
          collectionAddress,
          firstVerifiedCreator,
          collection.mintAddresses.length
        );
        if (!setVerifiedCreatorRes.isOk()) {
          res.status(500).json({
            success: false,
            message:
              "Failed to set collection address / first verified creator.",
          });
          return;
        }
      }

      collection.collectionAddress = collectionAddress;
      collection.firstVerifiedCreator = firstVerifiedCreator;
    }

    // add all of the mint addresses to the list of tracked addresses
    const addRes = await addAllMintsAsTracked(collection);
    if (!addRes.isOk()) {
      res.status(500).json({
        success: false,
        message: addRes.error.message,
      });
      return;
    }

    // create tasks to capture offchain data (images, metadata) for all mints
    const tasksPromises = collection.mintAddresses.map((mintAddress) =>
      addOffchainCachingTaskForMint(mintAddress)
    );
    await Promise.all(tasksPromises);

    // import all of the historical events and calculate stats
    const updateRes = await importAllEventsForCollection(collection);
    if (!updateRes.isOk()) {
      res.status(500).json({
        success: false,
        message: updateRes.error.message,
      });
      return;
    }

    // subscribe webhook to events about this creator address
    const helius = new Helius(HELIUS_API_KEY);
    await helius.appendAddressesToWebhook(HELIUS_WEBHOOK_ID, [
      firstVerifiedCreator,
    ]);

    res.status(200).json({
      success: true,
      totalVolume: updateRes.value.totalVolume,
      monthVolume: updateRes.value.monthVolume,
      weekVolume: updateRes.value.weekVolume,
      dayVolume: updateRes.value.dayVolume,
      athSale: updateRes.value.athSale ?? null,
      floor: updateRes.value.floor,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: (error as Error).message,
    });
  }
});

const cloudTasksClient = new CloudTasksClient({
  credentials: {
    private_key: process.env.GOOGLE_PRIVATE_KEY,
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
  },
});
const project = process.env.GOOGLE_CLOUD_PROJECT_ID || "";
const location = "us-central1";
const queue = "nft-cache-offchain";
const tasksParent = cloudTasksClient.queuePath(project, location, queue);

const addOffchainCachingTaskForMint = async (mintAddress: string) => {
  const taskName = `projects/${project}/locations/${location}/queues/${queue}/tasks/${mintAddress}`;

  await cloudTasksClient.createTask({
    parent: tasksParent,
    task: {
      name: taskName,
      httpRequest: {
        url: `https://1of1.tools/api/nfts/${mintAddress}/cache`,
        headers: {
          "Content-Type": "application/json",
          Authorization: HELIUS_AUTHORIZATION_SECRET,
        },
        httpMethod: "POST",
      },
    },
  });
};

export default apiRoute;
