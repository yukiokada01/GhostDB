// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint256, externalEuint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title GhostDocumentRegistry
/// @notice Manages encrypted documents and access keys using Zama FHE
contract GhostDocumentRegistry is ZamaEthereumConfig {
    struct Document {
        string name;
        string encryptedBody;
        euint256 encryptedAccessKey;
        address owner;
        address lastEditor;
        uint256 createdAt;
        uint256 updatedAt;
    }

    uint256 private _nextDocumentId = 1;
    mapping(uint256 => Document) private _documents;
    mapping(address => uint256[]) private _documentsByOwner;
    mapping(address => uint256[]) private _documentsByEditor;
    mapping(uint256 => mapping(address => bool)) private _editors;

    event DocumentCreated(uint256 indexed documentId, address indexed owner, string name);
    event DocumentUpdated(uint256 indexed documentId, address indexed editor, string encryptedBody);
    event EditorAllowed(uint256 indexed documentId, address indexed editor);

    modifier onlyExisting(uint256 documentId) {
        require(_documents[documentId].owner != address(0), "Document does not exist");
        _;
    }

    function _grantEditor(uint256 documentId, address editor) internal {
        if (!_editors[documentId][editor]) {
            _editors[documentId][editor] = true;
            _documentsByEditor[editor].push(documentId);
        }
    }

    /// @notice Create a new document with an encrypted access key
    /// @param name File name provided by the user
    /// @param encryptedAccessKey Encrypted access key handle produced by the relayer SDK
    /// @param inputProof Input proof from relayer encrypt()
    /// @return documentId Newly created document identifier
    function createDocument(
        string calldata name,
        externalEuint256 encryptedAccessKey,
        bytes calldata inputProof
    ) external returns (uint256 documentId) {
        require(bytes(name).length > 0, "Name required");

        documentId = _nextDocumentId++;

        euint256 storedKey = FHE.fromExternal(encryptedAccessKey, inputProof);

        Document storage document = _documents[documentId];
        document.name = name;
        document.encryptedBody = "";
        document.encryptedAccessKey = storedKey;
        document.owner = msg.sender;
        document.lastEditor = msg.sender;
        document.createdAt = block.timestamp;
        document.updatedAt = block.timestamp;

        _documentsByOwner[msg.sender].push(documentId);
        _grantEditor(documentId, msg.sender);

        // Allow the owner and contract to access the encrypted access key
        FHE.allow(storedKey, msg.sender);
        FHE.allowThis(storedKey);

        emit DocumentCreated(documentId, msg.sender, name);
    }

    /// @notice Update a document body with ciphertext encrypted using the access key
    /// @param documentId Target document id
    /// @param encryptedBody Ciphertext of the document body encrypted with the document key
    function updateDocument(uint256 documentId, string calldata encryptedBody)
        external
        onlyExisting(documentId)
    {
        require(_editors[documentId][msg.sender], "Not authorized");

        Document storage document = _documents[documentId];
        document.encryptedBody = encryptedBody;
        document.lastEditor = msg.sender;
        document.updatedAt = block.timestamp;

        emit DocumentUpdated(documentId, msg.sender, encryptedBody);
    }

    /// @notice Allow another address to decrypt the access key and edit the document
    /// @param documentId Target document id
    /// @param editor Address that should gain edit permissions
    function allowEditor(uint256 documentId, address editor)
        external
        onlyExisting(documentId)
    {
        require(editor != address(0), "Invalid editor");

        Document storage document = _documents[documentId];
        require(document.owner == msg.sender, "Only owner can allow");

        _grantEditor(documentId, editor);
        FHE.allow(document.encryptedAccessKey, editor);

        emit EditorAllowed(documentId, editor);
    }

    /// @notice Fetch document metadata and encrypted content
    function getDocument(uint256 documentId)
        external
        view
        onlyExisting(documentId)
        returns (
            string memory name,
            string memory encryptedBody,
            euint256 encryptedAccessKey,
            address owner,
            address lastEditor,
            uint256 createdAt,
            uint256 updatedAt
        )
    {
        Document storage document = _documents[documentId];

        return (
            document.name,
            document.encryptedBody,
            document.encryptedAccessKey,
            document.owner,
            document.lastEditor,
            document.createdAt,
            document.updatedAt
        );
    }

    /// @notice List document ids created by a specific owner
    /// @param ownerAddress Address whose documents should be listed
    function getDocumentsByOwner(address ownerAddress) external view returns (uint256[] memory) {
        return _documentsByOwner[ownerAddress];
    }

    /// @notice List document ids a given address can edit
    /// @param editor Address whose editable documents should be listed
    function getDocumentsForEditor(address editor) external view returns (uint256[] memory) {
        return _documentsByEditor[editor];
    }

    /// @notice Check whether an address can edit a document
    function isEditor(uint256 documentId, address account) external view onlyExisting(documentId) returns (bool) {
        return _editors[documentId][account];
    }
}
