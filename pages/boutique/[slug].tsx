import type { NextPage } from "next";
import { toast } from "react-hot-toast";
import { OneOfOneToolsClient } from "api-client";
import { NFTMetadata } from "models/nftMetadata";
import Head from "next/head";
import { shortPubKey, tryPublicKey } from "utils";
import { useRouter } from "next/router";
import { Connection, PublicKey } from "@solana/web3.js";
import { Metaplex, Nft } from "@metaplex-foundation/js";
import { network } from "utils/network";
import { useEffect, useState } from "react";
import { clusterApiUrl } from "utils/network";
import NFTGrid from "components/NFTGrid/NFTGrid";
import Header from "components/Header/Header";
import ErrorMessage from "components/ErrorMessage/ErrorMessage";
import InfiniteScroll from "react-infinite-scroll-component";
import { NFTS_PER_PAGE } from "utils/config";
import LoadingIndicator from "components/LoadingIndicator/LoadingIndicator";
import Layout from "components/Layout/Layout";
import LoadingGrid from "components/LoadingGrid/LoadingGrid";
import { Collection } from "models/collection";

const CollectionPage: NextPage = () => {
  const [isLoading, setLoading] = useState(false);

  const router = useRouter();
  const slug = router.query.slug as string;

  const [collection, setCollection] = useState<Collection>();
  const [mintList, setMintList] = useState<string[]>();
  const [nftsMetadata, setNFTsMetadata] = useState<NFTMetadata[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();

  const getCollection = async () => {
    const collectionRes = await OneOfOneToolsClient.boutiqueCollection(slug);
    if (collectionRes.isErr()) {
      setLoading(false);
      setErrorMessage(
        "Unable to retrieve collection: " + collectionRes.error.message
      );
      return;
    }
    const collection = collectionRes.value;
    setCollection(collection);
    setMintList(collection.mintAddresses);
  };

  const getMoreNfts = async () => {
    if (!mintList) {
      return;
    }
    const nftsRes = await OneOfOneToolsClient.nfts(
      mintList.slice(page * NFTS_PER_PAGE, (page + 1) * NFTS_PER_PAGE)
    );

    if (nftsRes.isErr()) {
      toast.error("Failed to load more nfts: " + nftsRes.error.message);
      return;
    }

    setNFTsMetadata((nftsMetadata) => [
      ...nftsMetadata,
      ...nftsRes.value.filter(
        (n) => nftsMetadata.find((n2) => n2.mint === n.mint) === undefined
      ),
    ]);
    setHasMore((page + 1) * NFTS_PER_PAGE < mintList.length);
    setPage(page + 1);
  };

  useEffect(() => {
    if (slug && nftsMetadata.length == 0 && !isLoading) {
      setLoading(true);
      getCollection();
    }
  }, [slug]);

  useEffect(() => {
    setNFTsMetadata([]);
    if (mintList) {
      if (mintList.length > 0) {
        getMoreNfts().then(() => {
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    }
  }, [mintList]);

  return (
    <Layout>
      <div>
        <Head>
          <title>one / one tools</title>
          <meta name="description" content="one / one tools" />
          <link rel="icon" href="/favicon.ico" />
        </Head>

        <div className="mt-4">
          {collection ? (
            <Header
              title={collection.name}
              subtitle={`${collection.mintAddresses.length} NFTs`}
              imgUrl={collection.imageURL ?? undefined}
            />
          ) : (
            <Header title={`NFTs in the collection: ${slug}`} />
          )}
        </div>

        <div className="mt-4">
          {nftsMetadata.length > 0 ? (
            <InfiniteScroll
              dataLength={nftsMetadata.length}
              next={getMoreNfts}
              hasMore={hasMore}
              loader={<LoadingIndicator />}
              endMessage={""}
            >
              <NFTGrid nfts={nftsMetadata} />
            </InfiniteScroll>
          ) : isLoading ? (
            <LoadingGrid />
          ) : (
            <ErrorMessage title={errorMessage ?? "No NFTs found"} />
          )}
        </div>
      </div>
    </Layout>
  );
};

export default CollectionPage;