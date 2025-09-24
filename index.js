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
      greetSettings[s.guild_id] = {
        guild_id: s.guild_id,
        channels: s.channels || [],
        message: s.message || 'Welcome {mention} 🎉',
        delete_time: s.delete_time || 0
      };
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

// حفظ إعدادات الترحيب
async function saveGreetSettings(guildId) {
  const settings = greetSettings[guildId];
  if (!settings) return;
  
  const { error } = await supabase.from('greet_settings').upsert({
    guild_id: settings.guild_id,
    channels: settings.channels,
    message: settings.message,
    delete_time: settings.delete_time
  });
  if (error) console.error('Error saving greet settings:', error);
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

// حذف رسالة الترحيب بعد وقت محدد
function scheduleGreetMessageDeletion(message, deleteTime) {
  if (deleteTime > 0) {
    setTimeout(async () => {
      try {
        await message.delete();
      } catch (error) {
        console.error('Error deleting greet message:', error);
      }
    }, deleteTime);
  }
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
  if (!settings || !settings.channels || settings.channels.length === 0 || !settings.message) return;

  const welcomeMessage = settings.message
    .replace(/{mention}/g, `<@${member.id}>`)
    .replace(/{username}/g, member.user.username);

  // إرسال رسالة الترحيب لكل القنوات المحددة
  for (const channelId of settings.channels) {
    const channel = member.guild.channels.cache.get(channelId);
    if (channel) {
      try {
        const sentMessage = await channel.send(welcomeMessage);
        // جدولة حذف الرسالة إذا كان هناك وقت محدد
        scheduleGreetMessageDeletion(sentMessage, settings.delete_time);
      } catch (error) {
        console.error('Error sending greet message:', error);
      }
    }
  }
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
- \`!greet\` → Add/remove greeting channel
- \`!greet set <message>\` → Set custom greeting
- \`!greet time <duration>\` → Set auto-delete time
- \`!greet reset\` → Remove all channels
- \`!greet clear\` → Reset everything
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

    // إنشاء إعدادات جديدة إذا لم تكن موجودة
    if (!greetSettings[message.guild.id]) {
      greetSettings[message.guild.id] = {
        guild_id: message.guild.id,
        channels: [],
        message: 'Welcome {mention} 🎉',
        delete_time: 0
      };
    }

    // !greet → إضافة/إزالة قناة الترحيب
    if (!subCommand) {
      const settings = greetSettings[message.guild.id];
      const channelId = message.channel.id;
      
      if (settings.channels.includes(channelId)) {
        // إزالة القناة
        settings.channels = settings.channels.filter(id => id !== channelId);
        await saveGreetSettings(message.guild.id);
        return message.reply(`✅ Greeting channel ${message.channel} removed`);
      } else {
        // إضافة القناة
        settings.channels.push(channelId);
        await saveGreetSettings(message.guild.id);
        return message.reply(`✅ Greeting channel ${message.channel} added`);
      }
    }

    // !greet set <message>
    if (subCommand === 'set') {
      const customMessage = args.slice(1).join(' ');
      if (!customMessage) return message.reply('❌ Usage: `!greet set <message>`');

      greetSettings[message.guild.id].message = customMessage;
      await saveGreetSettings(message.guild.id);
      return message.reply('✅ Greeting message updated!');
    }

    // !greet time <duration>
    if (subCommand === 'time') {
      const timeArg = args[1];
      if (!timeArg) return message.reply('❌ Usage: `!greet time <duration>` (e.g., 5s, 10m, 1h)');

      const timeMs = parseTime(timeArg);
      if (timeMs === 0) return message.reply('❌ Invalid time! Use format like 5s, 10m, 1h, 1d');

      greetSettings[message.guild.id].delete_time = timeMs;
      await saveGreetSettings(message.guild.id);
      return message.reply(`✅ Greeting messages will be deleted after ${formatTimeLeft(timeMs)}`);
    }

    // !greet reset → إزالة كل القنوات فقط
    if (subCommand === 'reset') {
      greetSettings[message.guild.id].channels = [];
      await saveGreetSettings(message.guild.id);
      return message.reply('✅ All greeting channels removed');
    }

    // !greet clear → إعادة تعيين كل شيء
    if (subCommand === 'clear') {
      await supabase.from('greet_settings').delete().eq('guild_id', message.guild.id);
      delete greetSettings[message.guild.id];
      return message.reply('✅ All greeting settings cleared');
    }

    // !greet test
    if (subCommand === 'test') {
      const settings = greetSettings[message.guild.id];
      if (!settings || !settings.channels || settings.channels.length === 0) {
        return message.reply('❌ No greeting channels set up');
      }
      
      const testMessage = settings.message
        .replace(/{mention}/g, `<@${message.author.id}>`)
        .replace(/{username}/g, message.author.username);
      
      let sentCount = 0;
      for (const channelId of settings.channels) {
        const channel = message.guild.channels.cache.get(channelId);
        if (channel) {
          try {
            const sentMessage = await channel.send(testMessage);
            scheduleGreetMessageDeletion(sentMessage, settings.delete_time);
            sentCount++;
          } catch (error) {
            console.error('Error sending test message:', error);
          }
        }
      }
      
      return message.reply(`✅ Test greeting sent to ${sentCount} channel(s)!`);
    }

    // !greet stats
    if (subCommand === 'stats') {
      const settings = greetSettings[message.guild.id];
      const embed = new EmbedBuilder()
        .setTitle('👋 Greeting Settings')
        .setColor('#00ff00');

      if (!settings || !settings.channels || settings.channels.length === 0) {
        embed.addFields({ name: 'Channels', value: 'No channels' });
      } else {
        const validChannels = settings.channels
          .map(id => message.guild.channels.cache.get(id))
          .filter(channel => channel)
          .map(channel => `<#${channel.id}>`)
          .join(', ') || 'No valid channels';
        embed.addFields({ name: 'Channels', value: validChannels });
      }

      embed.addFields(
        { name: 'Message', value: settings?.message || 'Welcome {mention} 🎉' },
        { 
          name: 'Delete Time', 
          value: settings?.delete_time > 0 
            ? formatTimeLeft(settings.delete_time) 
            : 'No auto-delete' 
        }
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
