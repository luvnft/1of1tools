import { QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { NFTEvent } from "models/nftEvent";
import { classNames, shortenedAddress, txUrl } from "utils";
import { network } from "utils/network";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import {
  humanReadableEventType,
  humanReadableSource,
  humanReadableSourceSm,
  isEventTypeAmountDisplayable,
  urlForSource,
} from "utils/helius";
import { TransactionType } from "helius-sdk";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(dayjs.tz.guess());

interface Props {
  events: NFTEvent[];
}

const EventsTable: React.FC<Props> = ({ events }) => {
  return events && events.length > 0 ? (
    <>
      <h2 className="text-xl mt-8 px-1">Events:</h2>
      <div className="mt-4 inline-block min-w-full align-middle">
        <div className="shadow-sm ring-1 ring-black ring-opacity-5">
          <table
            className="min-w-full border-separate text-left text-xs md:text-sm"
            style={{ borderSpacing: 0 }}
          >
            {/* ... (existing table structure remains the same) */}
            <tbody>
              {events.map((event, i) => {
                const marketplaceUrl =
                  (event.nfts ?? []).length > 0
                    ? urlForSource(event.source, event.nfts[0]!.mint)
                    : null;
                return (
                  <tr
                    key={event.signature}
                    className={classNames(
                      "bg-opacity-25 hover:bg-opacity-50",
                      i % 2 == 0 ? "bg-indigo-800" : "bg-indigo-700"
                    )}
                  >
                    {/* ... (existing table row structure remains the same) */}
                    <td className="whitespace-nowrap px-1 sm:px-2 py-4 text-slate-400 border-slate-700 border-opacity-75 ">
                      <span
                        aria-label={event.description}
                        data-microtip-position="top-left"
                        data-microtip-size="fit"
                        role="tooltip"
                      >
                        <span className="hidden sm:block">
                          <QuestionMarkCircleIcon className="w-5 h-5 text-gray-400 cursor-pointer" />
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  ) : (
    <></>
  );
};

export default EventsTable;
