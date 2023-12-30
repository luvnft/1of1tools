import type { NextApiRequest, NextApiResponse } from "next";
import nextConnect from "next-connect";
import { unstable_getServerSession } from "next-auth";
import { authOptions } from "pages/api/auth/[...nextauth]";
import {
  getDialectBoutiqueNotificationsByUser,
  getDiscordBoutiqueNotificationsByUser,
  setDialectBoutiqueNotificationsByUser,
  setDiscordBoutiqueNotificationsByUser,
} from "db";
import {
  createDialectSdk,
  findOrCreateSolanaThread,
  sendMessage,
} from "utils/dialect";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  TextChannel,
} from "discord.js";
import { Constants } from "models/constants";
import { DiscordGuildNotificationSetting } from "models/notificationSetting";

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

apiRoute.get(async (req, res) => {
  try {
    const session = await unstable_getServerSession(req, res, authOptions);
    const uid = session?.user?.id;
    if (!uid) {
      res.status(401).json({ message: "You must be logged in." });
      return;
    }

    const { deliveryType: type } = req.query;
    const deliveryType = type?.toString() ?? "dialect";

    if (deliveryType === "dialect") {
      const notifRes = await getDialectBoutiqueNotificationsByUser(uid);

      if (notifRes.isOk()) {
        res.status(200).json({
          success: true,
          settings: notifRes.value,
        });
      } else {
        res.status(500).json({
          success: false,
          message: notifRes.error.message,
        });
      }
    } else if (deliveryType === "discord") {
      const notifRes = await getDiscordBoutiqueNotificationsByUser(uid);

      if (notifRes.isOk()) {
        res.status(200).json({
          success: true,
          settings: notifRes.value,
        });
      } else {
        res.status(500).json({
          success: false,
          message: notifRes.error.message,
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: (error as Error).message,
    });
  }
});

apiRoute.put(async (req, res) => {
  try {
    const session = await unstable_getServerSession(req, res, authOptions);
    const uid = session?.user?.id;
    if (!uid) {
      res.status(401).json({ message: "You must be logged in." });
      return;
    }

    const deliveryType = req.body.deliveryType?.toString() ?? "dialect";

    if (deliveryType === "dialect") {
      let deliveryAddress = req.body.deliveryAddress?.toString();
      if (!deliveryAddress || deliveryAddress.length == 0) {
        deliveryAddress = uid;
      }

      const notifRes = await setDialectBoutiqueNotificationsByUser(
        uid,
        deliveryAddress
      );

      if (notifRes.isOk()) {
        const dialect = createDialectSdk();
        const { thread, isNew } = await findOrCreateSolanaThread(
          dialect,
          deliveryAddress
        );
        if (!thread) {
          res.status(500).json({
            success: false,
            message: "Unable to find or create thread on Dialect.",
          });
          return;
        }
        if (isNew) {
          await sendMessage(
            thread,
            `SOLd: You are now setup to receive notifications about boutique collections! Change your preferences at any time on https://sold.luvnft.com`
          );
        } else {
          await sendMessage(
            thread,
            `SOLd: Your notification preferences about boutique collections have been updated. Change them again at any time on https://sold.luvnft.com`
          );
        }

        res.status(200).json({
          success: true,
        });
      } else {
        res.status(500).json({
          success: false,
          message: notifRes.error.message,
        });
      }
    } else if (deliveryType === "discord") {
      let guildSubscriptions = req.body
        .guildSubscriptions as DiscordGuildNotificationSetting[];
      if (!guildSubscriptions) {
        res.status(400).json({ message: "Discord details are required." });
        return;
      }

      const notifRes = await setDiscordBoutiqueNotificationsByUser(
        uid,
        guildSubscriptions
      );

      if (notifRes.isOk()) {
        const discordClient = new Client({
          intents: [GatewayIntentBits.Guilds],
        });
        await discordClient.login(Constants.DISCORD_BOT_TOKEN);

        for (let i = 0; i < guildSubscriptions.length; i++) {
          const guildSubscription = guildSubscriptions[i]!;
          const guild = discordClient.guilds.cache.get(
            guildSubscription.guildId
          );
          if (!guild) {
            res.status(500).json({
              success: false,
              message: "Unable to find Discord server",
            });
            return;
          }
          await guild.channels.fetch();
          const channel = guild.channels.cache.get(
            guildSubscription.channelId
          ) as TextChannel;

          if (!channel) {
            res.status(500).json({
              success: false,
              message: "Unable to find channel on Discord server",
            });
            return;
          }

          const embed = new EmbedBuilder()
            .setColor(0x3730a3)
            .setTitle("Boutique Collections")
            .setURL(`https://sold.luvnft.com/boutique`)
            .setAuthor({
              name: "Events Subscription",
            })
            .setDescription(
              `Your notification preferences for boutique collections have been updated.`
            )
            .setTimestamp()
            .setFooter({
              text: "Powered by 1of1.tools",
            });

          await channel.send({ embeds: [embed] });
        }

        res.status(200).json({
          success: true,
        });
      } else {
        res.status(500).json({
          success: false,
          message: notifRes.error.message,
        });
      }
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: (error as Error).message,
    });
  }
});

export default apiRoute;
