# a edgeql that should delete all existing data in the db and set up the demo afresh (users with correct permissions etc)

delete release::Release;

delete dataset::Dataset;

delete lab::Analyses;
delete lab::Run;
delete lab::SubmissionBatch;

delete lab::ArtifactBam;
delete lab::ArtifactBase;
delete lab::ArtifactBcl;
delete lab::ArtifactCram;
delete lab::ArtifactFastqPair;
delete lab::ArtifactVcf;

delete storage::File;
