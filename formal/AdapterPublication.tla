----------------------- MODULE AdapterPublication -----------------------
EXTENDS Naturals
CONSTANT GuardAtPublish
VARIABLES pc, interrupted, evidence, artifact, cleanup, health, status, published
vars == <<pc, interrupted, evidence, artifact, cleanup, health, status, published>>
Init == /\ pc = "workflow"
        /\ interrupted = FALSE
        /\ evidence \in BOOLEAN
        /\ artifact \in BOOLEAN
        /\ cleanup \in BOOLEAN
        /\ health \in BOOLEAN
        /\ status = "running"
        /\ published = FALSE
Signal == /\ pc # "done" /\ ~interrupted
          /\ interrupted' = TRUE
          /\ UNCHANGED <<pc,evidence,artifact,cleanup,health,status,published>>
Validate == /\ pc = "workflow"
            /\ pc' = "cleanup"
            /\ status' = IF evidence /\ artifact /\ health THEN "workflow-passed" ELSE "failed"
            /\ UNCHANGED <<interrupted,evidence,artifact,cleanup,health,published>>
Cleanup == /\ pc = "cleanup"
           /\ pc' = "publish"
           /\ status' = IF cleanup THEN status ELSE "failed"
           /\ UNCHANGED <<interrupted,evidence,artifact,cleanup,health,published>>
Publish == /\ pc = "publish"
           /\ pc' = "done" /\ published' = TRUE
           /\ status' = IF GuardAtPublish /\ interrupted THEN "interrupted" ELSE status
           /\ UNCHANGED <<interrupted,evidence,artifact,cleanup,health>>
Done == /\ pc = "done" /\ UNCHANGED vars
Next == Signal \/ Validate \/ Cleanup \/ Publish \/ Done
Spec == Init /\ [][Next]_vars
NoFalsePass == (published /\ status = "workflow-passed") =>
               (~interrupted /\ evidence /\ artifact /\ cleanup /\ health)
InterruptedFails == (published /\ interrupted) => status = "interrupted"
=============================================================================
