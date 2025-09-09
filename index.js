// index.js
const { Client, IntentsBitField, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// إعداد البوت
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildMembers // ✅ ضروري للترحيب
  ]
});

// إعداد Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// متغيرات للحفظ في الذاكرة
let giveaways = {};
let greetSettings = {};

// تحميل القيفاويات من قاعدة البيانات
async function loadGiveaways() {
  const { data, error } = await supabase.from('giveaways').select('*');
  if (error) {
    console.error('Error loading giveaways:', error);
  } else {
    giveaways = {};
    data.forEach(g => {
      giveaways[g.id] = g;
    });
  }
}

// تحميل إعدادات الترحيب
async function loadGreetSettings() {
  const { data, error } = await supabase.from('greet_settings').select('*');
  if (error) {
    console.error('Error loading greet settings:', error);
  } else {
    greetSettings = {};
    data.forEach(s => {
      greetSettings[s.guild_id] = s;
    });
  }
}

// حفظ/تحديث قيفاوي
async function saveGiveaway(giveaway) {
  const { error } = await supabase.from('giveaways').upsert(giveaway);
  if (error) console.error('Error saving giveaway:', error);
}

// حذف قيفاوي
async function deleteGiveaway(id) {
  const { error } = await supabase.from('giveaways').delete().eq('id', id);
  if (error) console.error('Error deleting giveaway:', error);
}

// اختيار فائزين عشوائيين
function selectWinners(participants, count) {
  const shuffled = [...participants].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, participants.length));
}

// إنهاء القيفاوي
async function endGiveaway(giveawayId) {
  const giveaway = giveaways[giveawayId];
  if (!giveaway) return;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);

    let winners = [];
    if (giveaway.participants.length >= giveaway.winners) {
      winners = selectWinners(giveaway.participants, giveaway.winners);
    }

    const embed = new EmbedBuilder().setColor('#FF0000').setTimestamp();

    if (winners.length > 0) {
      const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
      embed.setTitle(`${giveaway.prize}`)
        .setDescription(`🔔 Winner(s): ${winnerMentions}
⚙️ Ending: Ended
↕️ Hosted by: <@${giveaway.hostId}>`)
        .setFooter({ text: `1` });

      await channel.send(`🎊 Congratulations ${winnerMentions}! You won **${giveaway.prize}**! 🎉`);
    } else {
      embed.setTitle(`🎉 ${giveaway.prize} 🎉`)
        .setDescription(`🔔 Winner(s): No valid entries
⚙️ Ending: Ended
↕️ Hosted by: <@${giveaway.hostId}>`)
        .setFooter({ text: `1` });
    }

    await message.edit({ embeds: [embed] });

    const { error } = await supabase.from('ended_giveaways').insert([{
      ...giveaway,
      endedAt: new Date().toISOString(),
      winners_list: winners
    }]);
    if (error) console.error('Error saving ended giveaway:', error);

    await deleteGiveaway(giveawayId);
    delete giveaways[giveawayId];
  } catch (error) {
    console.error('Error ending giveaway:', error);
  }
}

// تنسيق الوقت المتبقي
function formatTimeLeft(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((ms % (60 * 1000)) / 1000);

  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0) result += `${seconds}s`;

  return result || '0s';
}

// تحويل الوقت من نص إلى ميلي ثانية
function parseTime(timeString) {
  const regex = /(\d+)([smhd])/g;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(timeString)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's': totalMs += value * 1000; break;
      case 'm': totalMs += value * 60 * 1000; break;
      case 'h': totalMs += value * 60 * 60 * 1000; break;
      case 'd': totalMs += value * 24 * 60 * 60 * 1000; break;
    }
  }
  return totalMs;
}

// عند تشغيل البوت
client.once('ready', async () => {
  console.log(`Bot is ready: ${client.user.tag}`);
  await loadGiveaways();
  await loadGreetSettings();

  setInterval(() => {
    const now = Date.now();
    for (const [giveawayId, giveaway] of Object.entries(giveaways)) {
      if (now >= new Date(giveaway.endtime).getTime()) {
        endGiveaway(giveawayId);
      }
    }
  }, 5000);
});

// رسالة ترحيب عند دخول عضو
client.on('guildMemberAdd', async (member) => {
  const settings = greetSettings[member.guild.id];
  if (!settings || !settings.channel_id || !settings.message) return;

  const channel = member.guild.channels.cache.get(settings.channel_id);
  if (!channel) return;

  const welcomeMessage = settings.message
    .replace(/{mention}/g, `<@${member.id}>`)
    .replace(/{username}/g, member.user.username);

  channel.send(welcomeMessage);
});

// أوامر
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // gstart
  if (command === 'gstart') {
    if (!message.member.permissions.has('ManageEvents')) {
      return message.reply('❌ You need Manage Events permission to use this command');
    }
    if (args.length < 3) {
      return message.reply('❌ Usage: `!gstart <time> <winners_count> <prize>`');
    }

    const timeArg = args[0];
    const winnersCount = parseInt(args[1]);
    const prize = args.slice(2).join(' ');
    const duration = parseTime(timeArg);

    if (duration === 0) return message.reply('❌ Invalid time! Use 1h, 30m, 1d');
    if (isNaN(winnersCount) || winnersCount < 1) return message.reply('❌ Winners count must be > 0');

    message.delete().catch(() => {});

    const giveawayId = Date.now().toString();
    const endTime = new Date(Date.now() + duration).toISOString();

    const embed = new EmbedBuilder()
      .setTitle(`${prize}`)
      .setColor('#FFFF00')
      .setDescription(`🔔 React with 🎉 to enter !
⚙️ Ending: <t:${Math.floor((Date.now() + duration) / 1000)}:R>
↕️ Hosted by: <@${message.author.id}>`)
      .setFooter({ text: `🏆 Winners: ${winnersCount}` });

    const giveawayMessage = await message.channel.send({ embeds: [embed] });
    await giveawayMessage.react('🎉');

    giveaways[giveawayId] = {
      id: giveawayId,
      messageId: giveawayMessage.id,
      channelId: message.channel.id,
      guildId: message.guild.id,
      host: message.author.username,
      hostId: message.author.id,
      prize,
      winners: winnersCount,
      endtime: endTime,
      participants: []
    };
    await saveGiveaway(giveaways[giveawayId]);
  }

  // help
  else if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🎉 Giveaway Bot - Commands')
      .setColor('#FF0000')
      .setDescription('All available giveaway bot commands:')
      .addFields(
        {
          name: '🚀 !gstart `<time>` `<winners_count>` `<prize>`',
          value: 'Start a new giveaway'
        },
        {
          name: '🗑️ !gend `<message_id>`',
          value: 'End a giveaway manually'
        },
        {
          name: '📋 !glist',
          value: 'Show list of active giveaways'
        },
        {
          name: '🔄 !greroll `<message_id>`',
          value: 'Reroll winners for a giveaway'
        },
        {
          name: '👋 !greet',
          value: `Manage greeting settings:
- \`!greet\` → Set/remove greeting channel
- \`!greet set <message>\` → Set custom greeting
- \`!greet reset\` → Reset greeting
- \`!greet test\` → Test greeting
- \`!greet stats\` → Show current settings
\nVariables: {mention}, {username}`
        }
      );
    message.reply({ embeds: [helpEmbed] });
  }

  // gend
  else if (command === 'gend') {
    if (!message.member.permissions.has('ManageEvents')) return message.reply('❌ Permission needed');
    if (args.length === 0) return message.reply('❌ Usage: `!gend <message_id>`');

    const messageId = args[0];
    const giveawayId = Object.keys(giveaways).find(id => giveaways[id].messageId === messageId);
    if (!giveawayId) return message.reply('❌ No active giveaway found');

    await endGiveaway(giveawayId);
    message.reply('✅ Giveaway ended successfully!');
  }

  // glist
  else if (command === 'glist') {
    const pageSize = 10;
    const page = parseInt(args[0]) || 1;

    const active = Object.values(giveaways).filter(g => g.guildId === message.guild.id);
    if (active.length === 0) return message.reply('📋 No active giveaways currently');

    const totalPages = Math.ceil(active.length / pageSize);
    if (page < 1 || page > totalPages) {
      return message.reply(`❌ Invalid page. Please choose between 1 and ${totalPages}`);
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const giveawaysPage = active.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
      .setTitle(`📋 Active Giveaways (Page ${page}/${totalPages})`)
      .setColor('#0099ff');

    giveawaysPage.forEach((g, i) => {
      const endTimeMs = new Date(g.endtime).getTime();
      const timeLeft = formatTimeLeft(endTimeMs - Date.now());

      embed.addFields({
        name: `${startIndex + i + 1}. ${g.prize}`,
        value: `**Winners:** ${g.winners}\n**Time Left:** ${timeLeft}\n**ID:** ${g.messageId}`,
        inline: false
      });
    });

    let footerText = `Page ${page}/${totalPages}`;
    if (page < totalPages) {
      footerText = `Next page ➡ !glist ${page + 1} | ${footerText}`;
    }
    embed.setFooter({ text: footerText });

    message.reply({ embeds: [embed] });
  }

  // greroll
  else if (command === 'greroll') {
    if (!message.member.permissions.has('ManageEvents')) return message.reply('❌ Permission needed');
    if (args.length === 0) return message.reply('❌ Usage: `!greroll <message_id>`');

    const messageId = args[0];
    const { data, error } = await supabase.from('ended_giveaways').select('*').eq('messageId', messageId);
    if (error || !data || data.length === 0) return message.reply('❌ No ended giveaway found');

    const giveaway = data[0];
    if (giveaway.participants.length === 0) return message.reply('❌ No participants to reroll');

    const newWinners = selectWinners(giveaway.participants, giveaway.winners);
    const mentions = newWinners.map(id => `<@${id}>`).join(', ');
    message.channel.send(`🔄 Congratulations ${mentions}! You are the new winners of **${giveaway.prize}**!`);
  }

  // greet
  else if (command === 'greet') {
    if (!message.member.permissions.has('ManageGuild')) {
      return message.reply('❌ You need Manage Server permission to use this command');
    }

    const subCommand = args[0];

    // !greet → تعيين/إزالة روم الترحيب
    if (!subCommand) {
      const current = greetSettings[message.guild.id];
      if (current && current.channel_id === message.channel.id) {
        await supabase.from('greet_settings').delete().eq('guild_id', message.guild.id);
        delete greetSettings[message.guild.id];
        return message.reply('✅ Greeting channel removed');
      } else {
        const newSettings = {
          guild_id: message.guild.id,
          channel_id: message.channel.id,
          message: current?.message || 'Welcome {mention} 🎉'
        };
        await supabase.from('greet_settings').upsert(newSettings);
        greetSettings[message.guild.id] = newSettings;
        return message.reply(`✅ Greeting channel set to ${message.channel}`);
      }
    }

    // !greet set <message>
    if (subCommand === 'set') {
      const customMessage = args.slice(1).join(' ');
      if (!customMessage) return message.reply('❌ Usage: `!greet set <message>`');

      if (!greetSettings[message.guild.id]) {
        greetSettings[message.guild.id] = {
          guild_id: message.guild.id,
          channel_id: null,
          message: customMessage
        };
      } else {
        greetSettings[message.guild.id].message = customMessage;
      }

      await supabase.from('greet_settings').upsert(greetSettings[message.guild.id]);
      return message.reply('✅ Greeting message updated!');
    }

    // !greet reset
    if (subCommand === 'reset') {
      await supabase.from('greet_settings').delete().eq('guild_id', message.guild.id);
      delete greetSettings[message.guild.id];
      return message.reply('✅ Greeting reset (disabled)');
    }

    // !greet test
    if (subCommand === 'test') {
      const settings = greetSettings[message.guild.id];
      if (!settings || !settings.channel_id || !settings.message) {
        return message.reply('❌ Greeting is not set up');
      }
      const channel = message.guild.channels.cache.get(settings.channel_id);
      if (!channel) return message.reply('❌ Greeting channel not found');
      const testMessage = settings.message
        .replace(/{mention}/g, `<@${message.author.id}>`)
        .replace(/{username}/g, message.author.username);
      channel.send(testMessage);
      return message.reply('✅ Test greeting sent!');
    }

    // !greet stats
    if (subCommand === 'stats') {
      const settings = greetSettings[message.guild.id];
      if (!settings) return message.reply('❌ No greeting settings found');
      const embed = new EmbedBuilder()
        .setTitle('👋 Greeting Settings')
        .setColor('#00ff00')
        .addFields(
          { name: 'Channel', value: settings.channel_id ? `<#${settings.channel_id}>` : '❌ Not set' },
          { name: 'Message', value: settings.message || '❌ Not set' }
        );
      return message.reply({ embeds: [embed] });
    }
  }
});

// تفاعل المستخدمين
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  const giveawayId = Object.keys(giveaways).find(id => giveaways[id].messageId === reaction.message.id);
  if (!giveawayId) return;

  const giveaway = giveaways[giveawayId];
  if (!giveaway.participants.includes(user.id)) {
    giveaway.participants.push(user.id);
    await saveGiveaway(giveaway);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;
  const giveawayId = Object.keys(giveaways).find(id => giveaways[id].messageId === reaction.message.id);
  if (!giveawayId) return;

  const giveaway = giveaways[giveawayId];
  giveaway.participants = giveaway.participants.filter(id => id !== user.id);
  await saveGiveaway(giveaway);
});

// تسجيل الدخول
client.login(process.env.DISCORD_TOKEN);
