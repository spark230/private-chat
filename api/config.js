module.exports = (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://kvxawxyzywwklnbhehsl.supabase.co',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_19_JK_H9kBDNaIO45qaMLA_aH--9y25'
  });
};
