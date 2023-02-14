import { EnrichedTransaction } from "models/enrichedTransaction";
import { oneOfOneNFTEvent } from "models/nftEvent";
import type { NextApiRequest, NextApiResponse } from "next";
import nextConnect from "next-connect";
import {
  addBoutiqueCollectionEventIfMonitoredAndUpdateStats,
  getDialectSubscribersToBoutiqueNotifications,
  getDiscordSubscribersToBoutiqueNotifications,
} from "db";
import {
  DialectNotificationSetting,
  DiscordGuildNotificationSetting,
} from "models/notificationSetting";
import {
  createDialectSdk,
  findOrCreateSolanaThread,
  sendMessage,
} from "utils/dialect";
import { humanReadableTransaction } from "utils/helius";
import { discordEmbedForTransaction } from "utils/discord";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  TextChannel,
} from "discord.js";
import { Constants } from "models/constants";
import { DialectSdk } from "@dialectlabs/sdk";
import { Solana } from "@dialectlabs/blockchain-sdk-solana";

function unique(array: any[], propertyName: string) {
  return array.filter(
    (e, i) => array.findIndex((a) => a[propertyName] === e[propertyName]) === i
  );
}

let dialect: DialectSdk<Solana> | undefined;
let discordClient: Client | undefined;

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

// NFT_BID
// NFT_SALE
// NFT_LISTING
// NFT_MINT
// NFT_BID_CANCELLED
// NFT_CANCEL_LISTING
// NFT_AUCTION_CREATED
// NFT_AUCTION_UPDATED
// NFT_AUCTION_CANCELLED
// BURN

apiRoute.post(async (req, res) => {
  try {
    if (
      !req.headers["authorization"] ||
      req.headers["authorization"] !== HELIUS_AUTHORIZATION_SECRET
    ) {
      console.warn(
        "Received webhook with invalid/missing authorization header"
      );
      console.warn(JSON.stringify(req.body));
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const transaction = req.body as EnrichedTransaction;
    const event = transaction.events.nft
      ? oneOfOneNFTEvent(transaction.events.nft)
      : null;
    if (!event) {
      console.log(
        `Unexpected payload - nft event missing for ${transaction.signature}`
      );
      console.log(transaction);
      res.status(500).json({
        success: false,
        message: `Unexpected payload - nft event missing for ${transaction.signature}`,
      });
      return;
    }

    console.log(event);
    const addRes = await addBoutiqueCollectionEventIfMonitoredAndUpdateStats(
      event
    );
    if (!addRes.isOk()) {
      // not a monitored NFT for creator or collection address
      res.status(200).json({
        success: true,
      });
      return;
    }

    await sendNotifications(transaction);

    res.status(201).json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: (error as Error).message,
    });
  }
});

const sendNotifications = async (
  transaction: EnrichedTransaction
): Promise<null | Error> => {
  let lastError: Error | null = null;

  try {
    const customDescription = humanReadableTransaction(transaction);

    let recipients: DialectNotificationSetting[] = [];

    const recipientsSubscribedToDialect = await dialectSubscribers();
    recipients = recipients.concat(recipientsSubscribedToDialect);

    if (!dialect) {
      dialect = createDialectSdk();
    }

    await sendDialectMessagesForRecipients(
      dialect,
      unique(recipients, "deliveryAddress"),
      customDescription
    );
  } catch (error) {
    if (error instanceof Error) {
      lastError = error;
      console.error("Error sending dialect messages: " + error.message);
    } else {
      console.error("Error sending dialect messages: " + error);
    }
  }

  try {
    const recipientsSubscribedToDiscord = await discordSubscribers();
    const discordEmbed = discordEmbedForTransaction(transaction);

    if (!discordClient) {
      discordClient = new Client({
        intents: [GatewayIntentBits.Guilds],
      });
      await discordClient.login(Constants.DISCORD_BOT_TOKEN);
    }

    await sendDiscordMessagesForRecipients(
      discordClient,
      recipientsSubscribedToDiscord,
      discordEmbed
    );
  } catch (error) {
    if (error instanceof Error) {
      lastError = error;
      console.error("Error sending discord messages: " + error.message);
    } else {
      console.error("Error sending discord messages: " + error);
    }
  }

  return lastError;
};

const sendDialectMessagesForRecipients = async (
  dialect: DialectSdk<Solana>,
  recipients: DialectNotificationSetting[],
  message: string
) => {
  for (let j = 0; j < recipients.length; j++) {
    const recipient = recipients[j]!;
    const { thread, isNew } = await findOrCreateSolanaThread(
      dialect,
      recipient.deliveryAddress
    );
    if (!thread) {
      console.log("Failed to send message - no thread");
      continue;
    }

    await sendMessage(thread, message);
  }
};

const sendDiscordMessagesForRecipients = async (
  discordClient: Client,
  recipients: DiscordGuildNotificationSetting[],
  discordEmbed: EmbedBuilder
) => {
  for (let j = 0; j < recipients.length; j++) {
    const recipient = recipients[j]!;

    const guild = discordClient.guilds.cache.get(recipient.guildId);
    if (!guild) {
      continue;
    }
    const channel = guild.channels.cache.get(
      recipient.channelId
    ) as TextChannel;

    await channel.send({ embeds: [discordEmbed] });
  }
};

const dialectSubscribers = async (): Promise<DialectNotificationSetting[]> => {
  const recipientsRes = await getDialectSubscribersToBoutiqueNotifications();
  if (!recipientsRes.isOk()) {
    return [];
  }
  return recipientsRes.value;
};

const discordSubscribers = async (): Promise<
  DiscordGuildNotificationSetting[]
> => {
  const recipientsRes = await getDiscordSubscribersToBoutiqueNotifications();
  if (!recipientsRes.isOk()) {
    return [];
  }
  return recipientsRes.value;
};

export default apiRoute;
