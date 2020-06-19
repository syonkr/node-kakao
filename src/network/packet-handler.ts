/*
 * Created on Sat May 16 2020
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { EventEmitter } from "events";
import { PacketMessageRes } from "../packet/packet-message";
import { PacketMessageReadRes } from "../packet/packet-message-read";
import { PacketNewMemberRes } from "../packet/packet-new-member";
import { PacketSyncDeleteMessageRes } from "../packet/packet-sync-delete-message";
import { PacketLeftRes, PacketLeaveRes, PacketLeaveReq } from "../packet/packet-leave";
import { PacketLinkKickedRes } from "../packet/packet-link-kicked";
import { PacketChanJoinRes } from "../packet/packet-chan-join";
import { PacketJoinLinkRes } from "../packet/packet-join-link";
import { PacketSyncJoinOpenchatRes } from "../packet/packet-sync-join-openchat";
import { PacketSyncMemberTypeRes } from "../packet/packet-sync-member-type";
import { PacketSyncProfileRes } from "../packet/packet-sync-profile";
import { PacketKickMemberRes } from "../packet/packet-kick-member";
import { PacketDeleteMemberRes } from "../packet/packet-delmem";
import { PacketKickoutRes, LocoKickoutType } from "../packet/packet-kickout";
import { InviteFeed, OpenJoinFeed, DeleteAllFeed, ChatFeed, OpenKickFeed } from "../talk/chat/chat-feed";
import { LocoPacketHandler } from "../loco/loco-packet-handler";
import { NetworkManager } from "./network-manager";
import { LocoRequestPacket, LocoResponsePacket } from "../packet/loco-packet-base";
import { FeedType } from "../talk/feed/feed-type";
import { Long } from "bson";
import { PacketMetaChangeRes } from "../packet/packet-meta-change";
import { PacketSetMetaRes } from "../packet/packet-set-meta";
import { PacketChangeServerRes } from "../packet/packet-change-server";
import { PacketLoginRes } from "../packet/packet-login";
import { ChatUserInfo, OpenChatUserInfo } from "../talk/user/chat-user";
import { PacketUpdateLinkProfileReq, PacketUpdateLinkProfileRes } from "../packet/packet-update-link-profile";
import { FeedChat } from "../talk/chat/chat";
import { ManagedChatChannel, ManagedOpenChatChannel, ManagedBaseChatChannel } from "../talk/managed/managed-chat-channel";
import { ManagedOpenChatUserInfo } from "../talk/managed/managed-chat-user";

export class TalkPacketHandler extends EventEmitter implements LocoPacketHandler {

    private networkManager: NetworkManager;

    private kickReason: LocoKickoutType;

    constructor(networkManager: NetworkManager) {
        super();

        this.kickReason = LocoKickoutType.UNKNOWN;

        this.networkManager = networkManager;

        this.setMaxListeners(1000);

        this.on('LOGINLIST', this.onLogin.bind(this));
        this.on('MSG', this.onMessagePacket.bind(this));
        this.on('NEWMEM', this.onNewMember.bind(this));
        this.on('DECUNREAD', this.onMessageRead.bind(this));
        this.on('JOINLINK', this.onOpenChannelJoin.bind(this));
        this.on('SYNCLINKCR', this.syncOpenChannelJoin.bind(this));
        this.on('SYNCMEMT', this.syncMemberTypeChange.bind(this));
        this.on('SYNCLINKPF', this.syncProfileUpdate.bind(this));
        this.on('UPLINKPROF', this.syncClientProfileUpdate.bind(this));
        this.on('SETMETA', this.onMetaChange.bind(this));
        this.on('CHGMETA', this.onMetaChange.bind(this));
        this.on('KICKMEM', this.onOpenChannelKick.bind(this));
        this.on('DELMEM', this.onMemberDelete.bind(this));
        this.on('LINKKICKED', this.onLinkKicked.bind(this));
        this.on('SYNCJOIN', this.onChannelJoin.bind(this));
        this.on('SYNCDLMSG', this.syncMessageDelete.bind(this));
        this.on('LEFT', this.onChannelLeft.bind(this));
        this.on('LEAVE', this.onChannelLeave.bind(this));
        this.on('CHANGESVR', this.onSwitchServerReq.bind(this));
        this.on('KICKOUT', this.onLocoKicked.bind(this));
    }

    get NetworkManager() {
        return this.networkManager;
    }

    get Client() {
        return this.networkManager.Client;
    }

    get ChatManager() {
        return this.Client.ChatManager;
    }

    get ChannelManager() {
        return this.Client.ChannelManager;
    }
    
    get UserManager() {
        return this.Client.UserManager;
    }

    onRequest(packetId: number, packet: LocoRequestPacket): void {

    }
    
    onResponse(packetId: number, packet: LocoResponsePacket, reqPacket?: LocoRequestPacket): void {
        this.emit(packet.PacketName, packet, reqPacket);
    }

    onDisconnected(): void {
        if (this.kickReason !== LocoKickoutType.CHANGE_SERVER) {
            this.Client.emit('disconnected', this.kickReason);
        }
    }

    getManagedChannel(id: Long): ManagedChatChannel | ManagedOpenChatChannel | null {
        return this.ChannelManager.get(id) as ManagedChatChannel | ManagedOpenChatChannel | null;
    }

    async onLogin(packet: PacketLoginRes) {
        await this.Client.updateStatus();
    }

    onMessagePacket(packet: PacketMessageRes) {
        if (!packet.Chatlog) return;

        let chatLog = packet.Chatlog;
        let chat = this.ChatManager.chatFromChatlog(chatLog);

        if (!chat) return;
        
        let channel = chat.Channel as (ManagedChatChannel | ManagedOpenChatChannel);

        let userInfo = channel.getUserInfo(chat.Sender);
        if (userInfo) userInfo.updateNickname(packet.SenderNickname);

        channel.updateLastChat(chat);

        channel.emit('message', chat);
        this.Client.emit('message', chat);

        if (!chat.isFeed()) return;
        this.Client.emit('feed', chat);
    }

    onMessageRead(packet: PacketMessageReadRes) {
        let channel = this.getManagedChannel(packet.ChannelId);

        if (!channel) return;

        let reader = this.UserManager.get(packet.ReaderId);

        let watermark = packet.Watermark;

        reader.emit('message_read', channel, watermark);
        this.Client.emit('message_read', channel, reader, watermark);
    }

    onMetaChange(packet: PacketMetaChangeRes | PacketSetMetaRes) {
        if (!packet.Meta) return;

        let channel = this.getManagedChannel(packet.ChannelId);

        if (!channel) return;

        channel.updateMeta(packet.Meta);
    }

    async onNewMember(packet: PacketNewMemberRes) {
        if (!packet.Chatlog) return;

        let chatlog = packet.Chatlog;
        let chat = this.Client.ChatManager.chatFromChatlog(chatlog);

        if (!chat || !chat.isFeed()) return;

        let channel = chat.Channel as ManagedBaseChatChannel;

        let feed = ChatFeed.getFeedFromText(chat.Text);

        let idList: Long[] = [];
        if (feed.feedType === FeedType.INVITE && (feed as InviteFeed).members) {
            for (let member of (feed as InviteFeed).members) {
                idList.push(member.userId);
            }
        } else if (feed.feedType === FeedType.OPENLINK_JOIN && (feed as OpenJoinFeed).member) {
            idList.push((feed as OpenJoinFeed).member.userId);
        }

        let infoList: ChatUserInfo[] = (await this.UserManager.requestUserInfoList(channel, idList)).result!;

        for(let i = 0; i < idList.length; i++) {
            let id = idList[i];
            let userInfo = infoList[i];

            let user = this.UserManager.get(id);

            user.emit('join', channel, chat);

            if (user.isClientUser()) {
                this.Client.emit('join_channel', channel);
            } else {
                channel.updateUserInfo(id, userInfo);
                channel.emit('join', user, chat);
                this.Client.emit('user_join', channel, user, chat);
            }
        }
        
        this.Client.emit('feed', chat);
    }

    syncMessageDelete(packet: PacketSyncDeleteMessageRes) {
        if (!packet.Chatlog) return;

        let chat = this.ChatManager.chatFromChatlog(packet.Chatlog);

        if (!chat || !chat.isFeed()) return;

        let feed = chat.getFeed() as DeleteAllFeed;

        this.Client.emit('message_deleted', feed.logId || Long.ZERO, feed.hidden || false);
        this.Client.emit('feed', chat);
    }

    onChannelLeft(packet: PacketLeftRes) {
        let channel = this.getManagedChannel(packet.ChannelId);

        if (!channel) return;

        this.Client.emit('left_channel', channel);
        this.ChannelManager.removeChannel(channel.Id);
    }

    onChannelLeave(packet: PacketLeaveRes, reqPacket?: PacketLeaveReq) {
        if (!reqPacket || !reqPacket.ChannelId) return;

        let channel = this.getManagedChannel(reqPacket.ChannelId);

        if (!channel) return;

        this.Client.emit('left_channel', channel);
        this.ChannelManager.removeChannel(channel.Id);
    }

    onLinkKicked(packet: PacketLinkKickedRes) {
        if (!packet.Chatlog) return;

        let chat = this.ChatManager.chatFromChatlog(packet.Chatlog);

        if (!chat) return;

        let channel = chat.Channel;

        this.Client.emit('left_channel', channel);
        this.ChannelManager.removeChannel(channel.Id);

        if (!chat.isFeed()) return;
        this.Client.emit('feed', chat);
    }

    onChannelJoin(packet: PacketChanJoinRes) {
        if (!packet.Chatlog) return;

        let chanId = packet.ChannelId;

        let newChan = this.getManagedChannel(chanId);

        if (!newChan) return;

        let chat = this.ChatManager.chatFromChatlog(packet.Chatlog) as FeedChat;
        if (!chat.isFeed()) return;

        this.Client.emit('join_channel', newChan, chat);
        this.Client.emit('feed', chat);
    }

    onOpenChannelJoin(packet: PacketJoinLinkRes) {
        if (!packet.ChatInfo) return;

        let chanId = packet.ChatInfo.channelId;

        if (!packet.Chatlog) return;

        let chat = this.ChatManager.chatFromChatlog(packet.Chatlog) as FeedChat;

        if (!chat || !chat.isFeed()) return;
        
        let newChan = this.getManagedChannel(chanId);

        this.Client.emit('join_channel', newChan, chat);
        this.Client.emit('feed', chat);
    }

    async syncOpenChannelJoin(packet: PacketSyncJoinOpenchatRes) {
        if (!packet.ChatInfo) return; // DO NOTHING IF ITS NOT CREATING CHAT CHANNEL

        let chanId = packet.ChatInfo.channelId;

        if (this.ChannelManager.has(chanId) || !packet.ChatInfo) return;
        
        let newChan = await this.ChannelManager.addWithChannelInfo(chanId, packet.ChatInfo);

        this.Client.emit('join_channel', newChan);
    }

    syncMemberTypeChange(packet: PacketSyncMemberTypeRes) {
        let chanId = packet.ChannelId;

        let channel = this.getManagedChannel(chanId) as ManagedOpenChatChannel | null;

        if (!channel || !channel.isOpenChat()) return;

        let len = packet.MemberIdList.length;
        for (let i = 0; i < len; i++) {
            let info = channel.getUserInfoId(packet.MemberIdList[i]);

            if (info) info.updateMemberType(packet.MemberTypeList[i]);
        }
    }

    syncClientProfileUpdate(packet: PacketUpdateLinkProfileRes, reqPacket: PacketUpdateLinkProfileReq) {
        if (!packet.UpdatedProfile) return;

        let channel = this.ChannelManager.findOpenChatChannel(reqPacket.LinkId);

        if (!channel) return;
        
        (channel as ManagedOpenChatChannel).updateUserInfo(packet.UpdatedProfile.userId, this.UserManager.getInfoFromStruct(packet.UpdatedProfile) as ManagedOpenChatUserInfo);
    }
    
    syncProfileUpdate(packet: PacketSyncProfileRes) {
        let chanId = packet.ChannelId;

        if (!packet.OpenMember) return;

        let channel = this.getManagedChannel(chanId) as ManagedOpenChatChannel;

        if (!channel || !channel.isOpenChat()) return;

        channel.updateUserInfo(packet.OpenMember.userId, this.UserManager.getInfoFromStruct(packet.OpenMember) as ManagedOpenChatUserInfo);
    }

    onOpenChannelKick(packet: PacketKickMemberRes) {
        if (!packet.Chatlog) return;

        let chat = this.ChatManager.chatFromChatlog(packet.Chatlog) as FeedChat;

        if (!chat || !chat.isFeed()) return;

        let channel = chat.Channel as ManagedBaseChatChannel;
        let feed = chat.getFeed() as OpenKickFeed;

        if (!feed.member) return;

        let kickedUser = this.UserManager.get(feed.member.userId);

        kickedUser.emit('left', channel, chat);
        channel.emit('left', kickedUser, chat);
        this.Client.emit('user_left', kickedUser, chat);
        this.Client.emit('feed', chat);

        if (!this.Client.ClientUser.Id.equals(feed.member.userId)) channel.updateUserInfo(feed.member.userId, null);
    }

    onMemberDelete(packet: PacketDeleteMemberRes) {
        if (!packet.Chatlog) return;

        let chatLog = packet.Chatlog;

        let chat = this.ChatManager.chatFromChatlog(chatLog);

        if (!chat || !chat.isFeed()) return;

        let channel = chat.Channel as ManagedBaseChatChannel;

        let feed = chat.getFeed() as OpenKickFeed;

        if (!feed.member) return;
            
        let leftUser = this.UserManager.get(feed.member.userId);

        leftUser.emit('left', channel, chat);
        channel.emit('left', leftUser, chat);
        this.Client.emit('user_left', leftUser, chat);
        this.Client.emit('feed', chat);

        channel.updateUserInfo(feed.member.userId, null);
    }

     onSwitchServerReq(packet: PacketChangeServerRes) {
        this.kickReason = LocoKickoutType.CHANGE_SERVER;

        this.networkManager.disconnect();

        let accessData = this.Client.getLatestAccessData();

        // recache and relogin
        this.networkManager.getCheckinData(accessData.userId, true).then(() => {
            this.networkManager.locoLogin(this.Client.ApiClient.DeviceUUID, accessData.userId, accessData.accessToken)
                .then(() => this.kickReason = LocoKickoutType.UNKNOWN);
        });
    }

    onLocoKicked(packet: PacketKickoutRes) {
        let reason = packet.Reason;

        this.kickReason = reason;
    }
}
