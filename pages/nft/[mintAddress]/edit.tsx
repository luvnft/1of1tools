import type { NextPage } from "next";
import Head from "next/head";
import Header from "components/Header/Header";
import Layout from "components/Layout/Layout";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "react-hot-toast";
import ErrorMessage from "components/ErrorMessage/ErrorMessage";
import { clusterApiUrl, network } from "utils/network";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  Metaplex,
  Nft,
  NftWithToken,
  Sft,
  SftWithToken,
  toMetaplexFileFromBrowser,
  UpdateNftInput,
  walletAdapterIdentity,
} from "@metaplex-foundation/js";
import { notEmpty, shortenedAddress, tryPublicKey } from "utils";
import MintForm, {
  NFTFormData,
  StorageProvider,
  TokenType,
} from "components/MintForm/MintForm";
import {
  fileCategory,
  parseUriTypeFromNftJson,
  valid3DExtensions,
  validAudioExtensions,
  validImageExtensions,
  validVideoExtensions,
} from "utils/nftParse";
import LoadingImage from "components/LoadingImage/LoadingImage";
import { proxyImgUrl } from "utils/imgproxy";
import { CloudArrowDownIcon } from "@heroicons/react/24/outline";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { nftStorage } from "@metaplex-foundation/js-plugin-nft-storage";
import { GenesysGoStorageOptions } from "components/StorageConfig/GenesysGo/GenesysGoStorageConfig";
import { uploadFile, uploadMetadata } from "utils/storage";
import { ArweaveStorageOptions } from "components/StorageConfig/Arweave/ArweaveStorageConfig";

const Model = dynamic(() => import("components/Model"), { ssr: false });

const EditPage: NextPage = () => {
  const router = useRouter();
  const mintAddress = router.query.mintAddress as string;

  const [isLoading, setLoading] = useState(false);
  const [nft, setNft] = useState<Sft | SftWithToken | Nft | NftWithToken>();
  const [nftMediaFileUri, setNftMediaFileUri] = useState<string>();
  const [mediaFileType, setMediaFileType] = useState("image");

  const [updatedMediaFile, setUpdatedMediaFile] = useState<File>();
  const [mintingStatus, setMintingStatus] = useState<string>();

  const wallet = useWallet();
  const { connection } = useConnection();

  const loadNFT = async (mintAddress: string) => {
    const mintPublicKey = tryPublicKey(mintAddress);
    if (!mintPublicKey) {
      return;
    }

    try {
      const endpoint = clusterApiUrl(network);
      const connection = new Connection(endpoint);
      const mx = Metaplex.make(connection);
      const nft = await mx.nfts().findByMint({ mintAddress: mintPublicKey });

      if (nft.json) {
        const { type, uri } = parseUriTypeFromNftJson(nft.json);

        setNft(nft);
        setNftMediaFileUri(uri);
        setMediaFileType(type);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (mintAddress && !isLoading) {
      setLoading(true);
      loadNFT(mintAddress).then(() => {
        setLoading(false);
      });
    }
  }, [mintAddress, isLoading]);

  const updateNFT = async (
    metadata: NFTFormData,
    coverImage: File | undefined,
    tokenType: TokenType,
    isCrossmint: boolean, // ignored
    storageProvider: StorageProvider,
    storageOptions: GenesysGoStorageOptions | ArweaveStorageOptions | undefined
  ) => {
    try {
      if (!nft) {
        throw new Error("Starting NFT required");
      }

      console.log("Minting...");
      setMintingStatus("Minting...");

      if (!wallet || !wallet.connected || !wallet.publicKey) {
        throw new Error("No wallet connected.");
      }

      let collectionPublicKey: PublicKey | null | undefined;
      if (metadata.collectionAddress) {
        collectionPublicKey = tryPublicKey(metadata.collectionAddress);
        if (!collectionPublicKey) {
          throw new Error("Collection address was not valid");
        }
      }

      if (storageProvider === StorageProvider.GenesysGo && !storageOptions) {
        throw new Error(
          "Shadow Drive storage requires that you create and choose a storage account."
        );
      }

      if (storageProvider === StorageProvider.Arweave && !storageOptions) {
        throw new Error(
          "Arweave storage was chosen, but we were unable to initialize a connection via Bundlr."
        );
      }

      const mx = Metaplex.make(connection);
      mx.use(walletAdapterIdentity(wallet));

      if (storageProvider === StorageProvider.NFTStorage) {
        mx.use(
          nftStorage({
            token: process.env.NEXT_PUBLIC_NFT_STORAGE_API_KEY ?? "",
          })!
        );
      }

      let fullMediaLocation = nftMediaFileUri;
      let fullCoverLocation = nft?.json?.image;
      let category = mediaFileType;
      let files: { type: string; uri: string }[] =
        (nft?.json?.properties?.files?.filter((f) => f.type && f.uri) as {
          type: string;
          uri: string;
        }[]) ?? [];

      if (updatedMediaFile) {
        category = fileCategory(updatedMediaFile);

        console.log("Uploading media file...");
        setMintingStatus(`Uploading media file...`);

        const mediaFile = await toMetaplexFileFromBrowser(updatedMediaFile);
        const mediaFileLocation = await uploadFile(
          updatedMediaFile,
          mediaFile,
          mx,
          storageProvider,
          storageOptions
        );

        fullMediaLocation = `${mediaFileLocation}?ext=${mediaFile.extension?.toLowerCase()}`;

        files = [{ type: updatedMediaFile.type, uri: fullMediaLocation }];

        if (coverImage) {
          console.log(`Uploading cover file...`);
          setMintingStatus(`Uploading cover file...`);

          const coverMediaFile = await toMetaplexFileFromBrowser(coverImage);
          const coverFileLocation = await uploadFile(
            coverImage,
            coverMediaFile,
            mx,
            storageProvider,
            storageOptions
          );

          fullCoverLocation = `${coverFileLocation}?ext=${coverMediaFile.extension?.toLowerCase()}`;
        } else {
          fullCoverLocation = fullMediaLocation;
        }
      }

      const jsonMetadata = {
        name: metadata.name,
        symbol: metadata.symbol,
        description: metadata.description,
        seller_fee_basis_points: metadata.royalties * 100,
        image: fullCoverLocation,
        attributes: metadata.attributes
          .filter(
            (a) =>
              a.trait_type &&
              a.value &&
              a.trait_type.length > 0 &&
              a.value.length > 0
          )
          .map((a) => {
            return {
              trait_type: a.trait_type as string,
              value: a.value as string,
            };
          }),
        properties: {
          creators: metadata.creators.map((c) => {
            if (c.verified) {
              return {
                address: c.address,
                share: c.share,
                verified: c.verified,
              };
            } else {
              return { address: c.address, share: c.share };
            }
          }),
          category: category,
          files: files,
        },
      };

      console.log("Before");
      console.log(JSON.stringify(nft.json, null, 2));

      console.log("After");
      console.log(JSON.stringify(jsonMetadata, null, 2));

      console.log("Uploading metadata...");
      setMintingStatus("Uploading metadata...");
      const newUri = await uploadMetadata(
        jsonMetadata,
        mx,
        storageProvider,
        storageOptions
      );

      console.log("Writing to blockchain...");
      setMintingStatus("Writing to blockchain...");
      // account for the candy machine creator not included in the json file
      const metaplexOnlyCreators = nft.creators.filter(
        (c) =>
          nft.json?.properties?.creators?.find(
            (nc) => nc.address === c.address.toString()
          ) === undefined
      );

      const nftOnChainMetadata: UpdateNftInput = {
        nftOrSft: nft,
        uri: newUri,
        name: metadata.name,
        sellerFeeBasisPoints: metadata.royalties * 100,
        symbol: metadata.symbol,
        creators: metadata.creators
          .map((c) => {
            return c.address && c.share
              ? { address: new PublicKey(c.address), share: c.share }
              : null;
          })
          .filter(notEmpty)
          .concat(metaplexOnlyCreators),
      };
      if (collectionPublicKey && tokenType !== TokenType.Collection) {
        nftOnChainMetadata.collection = collectionPublicKey;
        nftOnChainMetadata.collectionAuthority = mx.identity();
        if (nft.collection?.address) {
          nftOnChainMetadata.oldCollectionAuthority = mx.identity();
        }
      }

      const result = await mx
        .nfts()
        .update(nftOnChainMetadata, { commitment: "finalized" });
      if (result.response.confirmResponse.value.err) {
        throw new Error(result.response.confirmResponse.value.err.toString());
      }
      toast.success("Update complete!");
      router.reload();
    } catch (error) {
      if (error instanceof Error) {
        console.log(error.message);
      } else {
        console.log(error);
      }

      toast.error("Update failed. See Console for details.");
    }
    setMintingStatus(undefined);
  };

  return (
    <Layout>
      <div>
        <Head>
          <title>🛒 SOLd</title>
          <meta name="SOLd" content="We SOLd out on Solana." />
          <link rel="icon" href="/favicon.ico" />
        </Head>

        <div className="mt-4">
          <Header
            title={
              mintAddress
                ? `Edit NFT ${shortenedAddress(mintAddress)}`
                : "Edit NFT"
            }
            right={
              nft && !nft.isMutable ? (
                <span className="text-red-400">
                  This NFT is immutable - it cannot be changed.
                </span>
              ) : undefined
            }
          />
        </div>

        <div className="mt-4">
          {mintingStatus ? (
            <div className="animate-pulse w-full h-[80vh] flex flex-col gap-10 items-center justify-center text-center text-3xl">
              {mintingStatus}
            </div>
          ) : nft && nftMediaFileUri ? (
            <div className="flex gap-8 flex-col md:flex-row mt-8 px-1">
              <div className="relative w-full md:w-1/3 lg:w-1/2">
                {updatedMediaFile ? (
                  validImageExtensions.find((f) =>
                    updatedMediaFile.name.toLowerCase().endsWith("." + f)
                  ) ? (
                    <img
                      src={URL.createObjectURL(updatedMediaFile)}
                      alt="NFT Image"
                      className="w-full"
                    />
                  ) : validVideoExtensions.find((f) =>
                      updatedMediaFile.name.toLowerCase().endsWith("." + f)
                    ) ? (
                    <video
                      playsInline
                      autoPlay
                      controls
                      loop
                      poster={nft.json?.image}
                    >
                      <source src={URL.createObjectURL(updatedMediaFile)} />
                    </video>
                  ) : validAudioExtensions.find((f) =>
                      updatedMediaFile.name.toLowerCase().endsWith("." + f)
                    ) ? (
                    <audio autoPlay controls loop>
                      <source src={URL.createObjectURL(updatedMediaFile)} />
                    </audio>
                  ) : valid3DExtensions.find((f) =>
                      updatedMediaFile.name.toLowerCase().endsWith("." + f)
                    ) ? (
                    <Model src={URL.createObjectURL(updatedMediaFile)}></Model>
                  ) : (
                    updatedMediaFile.name
                  )
                ) : mediaFileType === "image" ? (
                  <LoadingImage
                    src={proxyImgUrl(nftMediaFileUri, 1024, 1024)}
                    backupSrc={nftMediaFileUri}
                    loader={
                      <div className="flex flex-col gap-2 justify-center items-center w-full h-[400px] rounded-xl bg-indigo-500 bg-opacity-10 text-xs animate-pulse">
                        <CloudArrowDownIcon className="w-6 h-6" />
                        <span>Loading...</span>
                      </div>
                    }
                    alt={nft.name}
                    data-orig-url={nftMediaFileUri}
                    className="w-full"
                    loading="lazy"
                  />
                ) : mediaFileType === "video" ? (
                  <video
                    playsInline
                    autoPlay
                    controls
                    loop
                    poster={nft.json?.image}
                  >
                    <source src={nftMediaFileUri} />
                  </video>
                ) : mediaFileType === "audio" ? (
                  <audio autoPlay controls loop>
                    <source src={nftMediaFileUri} />
                  </audio>
                ) : mediaFileType === "model" ? (
                  <Model src={nftMediaFileUri}></Model>
                ) : (
                  nftMediaFileUri
                )}
                <form className="mt-4 w-full text-center">
                  <label className="button mx-auto">
                    <input
                      type={"file"}
                      accept={validImageExtensions
                        .map((e) => "." + e)
                        .concat(validVideoExtensions.map((e) => "." + e))
                        .concat(validAudioExtensions.map((e) => "." + e))
                        .concat(valid3DExtensions.map((e) => "." + e))
                        .join(",")}
                      onChange={(e) => {
                        if (e.target.files) {
                          setUpdatedMediaFile(e.target.files[0]);
                        } else {
                          setUpdatedMediaFile(undefined);
                        }
                      }}
                      hidden
                    ></input>
                    <span className="py-5 px-5 inline-block">
                      <span className="text-2xl leading-5 block">
                        Update Media File
                      </span>
                      <span className="block mt-4 text-sm">
                        (Image, Video, Audio, 3D Model)
                      </span>
                    </span>
                  </label>
                </form>
              </div>
              <div className="w-full md:w-2/3 lg:w-1/2">
                <MintForm
                  isEdit={true}
                  nft={nft}
                  includeCoverImage={mediaFileType !== "image"}
                  onComplete={updateNFT}
                />
              </div>
            </div>
          ) : isLoading ? (
            <div className="animate-pulse w-full h-[80vh] flex flex-col gap-10 items-center justify-center text-center text-3xl">
              Loading...
            </div>
          ) : (
            <ErrorMessage title="NFT not found" />
          )}
        </div>
      </div>
    </Layout>
  );
};

export default EditPage;
